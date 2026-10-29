#!/usr/bin/env python3
"""Builds one offline vector map (PMTiles v3) for Tarang and the Mac radio panel.

Cuts the areas listed in AREAS out of a Protomaps daily planet build with HTTP range requests
(only the needed directories and tiles are downloaded), deduplicating identical tiles (open ocean,
empty land) inside each archive. Protomaps explicitly allows extracting
from its builds; OSM's own tile servers forbid this kind of bulk download.

Standard library only.  Usage:
    make_offline_map.py OUT_DIR [--build 20261028] [--dry-run] [--assets] [--style-only]

The areas come from android/src/main/assets/maps/areas.json, which the phone's downloader
(MapDownloader.kt) reads too. OUT_DIR is the Mac radio panel's maps/ folder.

Each area becomes its own archive whose header carries that area's bounds and zoom range, so the
map falls back to the coarser area (overzoomed) outside a detailed one instead of going blank.
style.json draws the areas in order, coarse to fine; source URLs and the glyph path use the
placeholder {MAPS}, which each app replaces with where the files live (pmtiles://{MAPS}/x.pmtiles).
"""
import argparse
import gzip
import hashlib
import json
import math
import os
import struct
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BUILDS = "https://build.protomaps.com/"

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "android", "src", "main", "assets", "maps")


def load_areas():
    """(name, (west, south, east, north), min zoom, max zoom), coarse to fine. Zoom 15 is street level."""
    with open(os.path.join(ASSETS, "areas.json")) as f:
        return [(a["name"], tuple(a["bounds"]), a["minzoom"], a["maxzoom"]) for a in json.load(f)["areas"]]


AREAS = load_areas()
LITE = ("World lite", (-180, -85, 180, 85), 0, 4)  # bundled in the APK

UA = "Tarang offline map builder (personal use)"
MAX_GAP = 256 * 1024      # merge tile reads whose gap is below this into one request
MAX_SPAN = 8 * 1024 * 1024


# ---- PMTiles v3 primitives -------------------------------------------------------------------

def zxy_to_id(z, x, y):
    acc = ((1 << (2 * z)) - 1) // 3
    s = 1 << (z - 1) if z else 0
    while s > 0:
        rx = 1 if x & s else 0
        ry = 1 if y & s else 0
        acc += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                x, y = s - 1 - x, s - 1 - y
            x, y = y, x
        s >>= 1
    return acc


def read_varint(b, pos):
    shift = result = 0
    while True:
        byte = b[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def write_varint(out, v):
    while v >= 0x80:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    out.append(v)


def decompress(data, kind):
    return gzip.decompress(data) if kind == 2 else data


def parse_dir(data):
    n, p = read_varint(data, 0)
    ids, runs, lens, offs = [0] * n, [0] * n, [0] * n, [0] * n
    last = 0
    for i in range(n):
        d, p = read_varint(data, p)
        last += d
        ids[i] = last
    for i in range(n):
        runs[i], p = read_varint(data, p)
    for i in range(n):
        lens[i], p = read_varint(data, p)
    for i in range(n):
        v, p = read_varint(data, p)
        offs[i] = offs[i - 1] + lens[i - 1] if v == 0 and i > 0 else v - 1
    return list(zip(ids, runs, offs, lens))


def serialize_dir(entries):
    out = bytearray()
    write_varint(out, len(entries))
    last = 0
    for tid, _, _, _ in entries:
        write_varint(out, tid - last)
        last = tid
    for _, run, _, _ in entries:
        write_varint(out, run)
    for _, _, _, length in entries:
        write_varint(out, length)
    for i, (_, _, off, _) in enumerate(entries):
        prev = entries[i - 1] if i else None
        write_varint(out, 0 if prev and off == prev[2] + prev[3] else off + 1)
    return gzip.compress(bytes(out), mtime=0)


HEADER = struct.Struct("<7sB11Q6B4iB2i")


def parse_header(b):
    f = HEADER.unpack(b[:127])
    keys = ["magic", "version", "root_off", "root_len", "meta_off", "meta_len", "leaf_off", "leaf_len",
            "data_off", "data_len", "n_addressed", "n_entries", "n_contents", "clustered", "internal_comp",
            "tile_comp", "tile_type", "min_zoom", "max_zoom", "min_lon", "min_lat", "max_lon", "max_lat",
            "center_zoom", "center_lon", "center_lat"]
    h = dict(zip(keys, f))
    if h["magic"] != b"PMTiles" or h["version"] != 3:
        sys.exit("not a PMTiles v3 archive")
    return h


# ---- remote reading --------------------------------------------------------------------------

class Remote:
    def __init__(self, url):
        self.url = url
        self.requests = self.bytes = 0
        self.header = parse_header(self.get(0, 16384))
        h = self.header
        self.root = parse_dir(decompress(self.get(h["root_off"], h["root_len"]), h["internal_comp"]))
        self.leaves = {}

    def get(self, off, length):
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={off}-{off + length - 1}", "User-Agent": UA})
        err = "short read"
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                if len(data) == length:
                    self.requests += 1
                    self.bytes += length
                    return data
            except OSError as e:
                err = e
            time.sleep(1 + attempt * 2)
        raise RuntimeError(f"range {off}+{length} failed: {err}")

    def metadata(self):
        h = self.header
        return json.loads(decompress(self.get(h["meta_off"], h["meta_len"]), h["internal_comp"]))

    def _leaf(self, off, length):
        key = (off, length)
        if key not in self.leaves:
            h = self.header
            self.leaves[key] = parse_dir(decompress(self.get(h["leaf_off"] + off, length), h["internal_comp"]))
        return self.leaves[key]

    def lookup(self, entries_at, ids):
        """Resolve sorted tile ids to (id, absolute offset, length); leaf directories load on demand."""
        out, stack = [], [(entries_at, ids)]
        while stack:
            entries, want = stack.pop()
            starts = [e[0] for e in entries]
            groups = {}
            j = 0
            for tid in want:
                while j + 1 < len(starts) and starts[j + 1] <= tid:
                    j += 1
                e = entries[j]
                if tid < e[0]:
                    continue
                if e[1] == 0:
                    groups.setdefault(j, []).append(tid)
                elif tid < e[0] + e[1]:
                    out.append((tid, self.header["data_off"] + e[2], e[3]))
            for j, sub in groups.items():
                e = entries[j]
                stack.append((self._leaf(e[2], e[3]), sub))
        return sorted(out)


# ---- area -> tiles ---------------------------------------------------------------------------

def lonlat_to_tile(lon, lat, z):
    n = 1 << z
    lat = max(-85.0511, min(85.0511, lat))
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def wanted_ids(areas):
    ids = set()
    for _, (w, s, e, n), z0, z1 in areas:
        for z in range(z0, z1 + 1):
            x0, y0 = lonlat_to_tile(w, n, z)
            x1, y1 = lonlat_to_tile(e, s, z)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    ids.add(zxy_to_id(z, x, y))
    return sorted(ids)


def batches(tiles):
    """Group (id, off, len) by source offset into merged range requests."""
    tiles = sorted(tiles, key=lambda t: t[1])
    cur = []
    for t in tiles:
        if cur and (t[1] - (cur[-1][1] + cur[-1][2]) > MAX_GAP or t[1] + t[2] - cur[0][1] > MAX_SPAN):
            yield cur
            cur = []
        cur.append(t)
    if cur:
        yield cur


# ---- writing ---------------------------------------------------------------------------------

def build_dirs(entries):
    """Root directory, plus leaf directories when the root would not fit the 16 KB header block."""
    root = serialize_dir(entries)
    if len(root) <= 16384 - 127:
        return root, b""
    leaf_size = 4096
    while True:
        leaves, roots = bytearray(), []
        for i in range(0, len(entries), leaf_size):
            chunk = entries[i:i + leaf_size]
            d = serialize_dir(chunk)
            roots.append((chunk[0][0], 0, len(leaves), len(d)))
            leaves += d
        root = serialize_dir(roots)
        if len(root) <= 16384 - 127:
            return root, bytes(leaves)
        leaf_size *= 2


def write_archive(path, tiles, src_header, meta, area):
    """tiles: sorted list of (tile id, bytes) for one area."""
    blobs, by_hash, entries = bytearray(), {}, []
    for tid, data in tiles:
        h = hashlib.sha1(data).digest()
        if h in by_hash:
            off = by_hash[h]
        else:
            off = by_hash[h] = len(blobs)
            blobs += data
        last = entries[-1] if entries else None
        if last and last[0] + last[1] == tid and last[2] == off:
            entries[-1] = (last[0], last[1] + 1, last[2], last[3])
        else:
            entries.append((tid, 1, off, len(data)))
    root, leaves = build_dirs(entries)
    meta_b = gzip.compress(json.dumps(meta, separators=(",", ":")).encode(), mtime=0)
    _, (w, s, e, n), z0, z1 = area
    root_off = 127
    meta_off = root_off + len(root)
    leaf_off = meta_off + len(meta_b)
    data_off = leaf_off + len(leaves)
    header = HEADER.pack(b"PMTiles", 3, root_off, len(root), meta_off, len(meta_b), leaf_off, len(leaves),
                         data_off, len(blobs), len(tiles), len(entries), len(by_hash), 1, 2,
                         src_header["tile_comp"], src_header["tile_type"], z0, z1,
                         int(w * 1e7), int(s * 1e7), int(e * 1e7), int(n * 1e7),
                         z0, int((w + e) / 2 * 1e7), int((s + n) / 2 * 1e7))
    with open(path, "wb") as f:
        f.write(header); f.write(root); f.write(meta_b); f.write(leaves); f.write(blobs)
    return len(blobs)


# ---- style -----------------------------------------------------------------------------------

C = {  # dark, low-contrast, so planes and stations stand out on top
    "ocean": "#0a1520", "land": "#121a22", "park": "#13201a", "urban": "#151d26", "water": "#0d1b29",
    "minor": "#1f2a35", "major": "#2b3846", "highway": "#3a4a5b", "rail": "#2a3440", "runway": "#3b3f52",
    "building": "#18212b", "border": "#55657a", "region": "#334050", "label": "#93a4b6", "town": "#b8c6d4",
    "halo": "#0a1018", "airport": "#8fa8ff",
}
NAME = ["coalesce", ["get", "name:en"], ["get", "name"]]
FONT = ["Noto Sans Regular"]
FONT_B = ["Noto Sans Medium"]


def style(index):
    """MapLibre style for the areas in index (coarse first). Works in GL JS and MapLibre Native."""
    sources, fills, lines, labels = {}, [], [], []
    for i, a in enumerate(index):
        src = f"a{i}"
        sources[src] = {"type": "vector", "url": "pmtiles://{MAPS}/" + a["file"],
                        "attribution": "© OpenStreetMap contributors, Protomaps"}
        top = a["maxzoom"] + 1   # labels of a coarse area hide where a finer one takes over

        def L(kind, layer, **kw):
            d = {"id": f"{src}-{kw.pop('id')}", "type": kind, "source": src, "source-layer": layer}
            d.update(kw)
            return d
        fills += [
            L("fill", "earth", id="earth", paint={"fill-color": C["land"]}),
            L("fill", "landuse", id="park", filter=["in", ["get", "kind"], ["literal", ["park", "forest", "wood", "nature_reserve", "national_park", "grass", "golf_course"]]],
              paint={"fill-color": C["park"]}),
            L("fill", "landuse", id="urban", filter=["in", ["get", "kind"], ["literal", ["residential", "industrial", "commercial", "retail", "aerodrome"]]],
              paint={"fill-color": C["urban"]}),
            L("fill", "landuse", id="runway", filter=["in", ["get", "kind"], ["literal", ["runway", "taxiway"]]],
              paint={"fill-color": C["runway"]}),
            L("fill", "water", id="water", filter=["==", ["geometry-type"], "Polygon"],
              paint={"fill-color": ["match", ["get", "kind"], "ocean", C["ocean"], C["water"]]}),
            L("fill", "buildings", id="buildings", minzoom=14, paint={"fill-color": C["building"]}),
        ]
        lines += [
            L("line", "water", id="river", filter=["==", ["geometry-type"], "LineString"],
              paint={"line-color": C["water"], "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 15, 3]}),
            L("line", "roads", id="minor", filter=["in", ["get", "kind"], ["literal", ["minor_road", "other"]]], minzoom=11,
              paint={"line-color": C["minor"], "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, 0.4, 16, 5]}),
            L("line", "roads", id="major", filter=["==", ["get", "kind"], "major_road"],
              paint={"line-color": C["major"], "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 7, 0.4, 16, 7]}),
            L("line", "roads", id="highway", filter=["==", ["get", "kind"], "highway"],
              paint={"line-color": C["highway"], "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 5, 0.5, 16, 9]}),
            L("line", "roads", id="runway-line", filter=["in", ["get", "kind_detail"], ["literal", ["runway", "taxiway"]]],
              paint={"line-color": C["runway"], "line-width": ["interpolate", ["exponential", 1.8], ["zoom"],
                     10, ["match", ["get", "kind_detail"], "runway", 1, 0.3], 15, ["match", ["get", "kind_detail"], "runway", 16, 5]]}),
            L("line", "transit", id="rail", minzoom=10, filter=["==", ["get", "kind"], "rail"],
              paint={"line-color": C["rail"], "line-width": 1, "line-dasharray": [3, 2]}),
            L("line", "boundaries", id="region", filter=[">", ["get", "kind_detail"], 2],
              paint={"line-color": C["region"], "line-width": 0.8, "line-dasharray": [3, 2]}),
            L("line", "boundaries", id="country", filter=["<=", ["get", "kind_detail"], 2],
              paint={"line-color": C["border"], "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 10, 1.6]}),
        ]
        sym = {"text-field": NAME, "text-font": FONT, "text-max-width": 8}
        halo = {"text-halo-color": C["halo"], "text-halo-width": 1.4}
        labels += [
            L("symbol", "roads", id="road-label", minzoom=13, maxzoom=top, filter=["in", ["get", "kind"], ["literal", ["highway", "major_road", "minor_road"]]],
              layout={**sym, "symbol-placement": "line", "text-size": 11}, paint={"text-color": C["label"], **halo}),
            L("symbol", "pois", id="airport", maxzoom=top, filter=["==", ["get", "kind"], "aerodrome"],
              layout={**sym, "text-font": FONT_B, "text-field": ["coalesce", ["get", "iata"], NAME], "text-size": 12},
              paint={"text-color": C["airport"], **halo}),
            L("symbol", "places", id="places", maxzoom=top, filter=["!=", ["get", "kind"], "country"],
              layout={**sym, "text-size": ["interpolate", ["linear"], ["zoom"], 5, ["match", ["get", "kind"], "region", 10, 11],
                                           12, ["match", ["get", "kind"], "neighbourhood", 11, 14]],
                      "symbol-sort-key": ["get", "min_zoom"]},
              paint={"text-color": ["match", ["get", "kind"], "locality", C["town"], C["label"]], **halo}),
            L("symbol", "places", id="country-label", maxzoom=top, filter=["==", ["get", "kind"], "country"],
              layout={**sym, "text-font": FONT_B, "text-size": 12, "text-transform": "uppercase", "text-letter-spacing": 0.1},
              paint={"text-color": C["label"], **halo}),
        ]
    return {"version": 8, "name": "Tarang offline", "glyphs": "{MAPS}/fonts/{fontstack}/{range}.pbf",
            "sources": sources, "layers": [{"id": "ocean", "type": "background", "paint": {"background-color": C["ocean"]}}]
            + fills + lines + labels}


def slug(name):
    return "".join(c if c.isalnum() else "-" for c in name.lower())


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out_dir", help="writes <area>.pmtiles per area, index.json and style.json here")
    ap.add_argument("--build", help="Protomaps build date, e.g. 20261028 (default: latest)")
    ap.add_argument("--dry-run", action="store_true", help="only report what would be downloaded")
    ap.add_argument("--style-only", action="store_true", help="only rewrite style.json (here and in the APK assets)")
    ap.add_argument("--assets", action="store_true",
                    help="also refresh the APK assets: style.json, world-lite.pmtiles and the Latin label glyphs")
    args = ap.parse_args()
    index = [{"file": slug(a[0]) + ".pmtiles", "name": a[0], "bounds": list(a[1]), "minzoom": a[2], "maxzoom": a[3]} for a in AREAS]
    if args.style_only:
        write_styles(args.out_dir, index)
        return

    assert [zxy_to_id(1, 0, 0), zxy_to_id(1, 0, 1), zxy_to_id(1, 1, 1), zxy_to_id(1, 1, 0)] == [1, 2, 3, 4]
    build = args.build
    if not build:
        req = urllib.request.Request("https://build-metadata.protomaps.dev/builds.json", headers={"User-Agent": UA})
        build = json.load(urllib.request.urlopen(req, timeout=30))[-1]["key"].removesuffix(".pmtiles")
    src = Remote(f"{BUILDS}{build}.pmtiles")
    areas = AREAS + ([LITE] if args.assets else [])
    per_area = [src.lookup(src.root, wanted_ids([a])) for a in areas]
    tiles = sorted({t for ts in per_area for t in ts})
    unique = sum({t[1]: t[2] for t in tiles}.values())
    print(f"build {build}: {len(tiles)} tiles, {unique / 1e6:.0f} MB to download; directories took {src.requests} requests")
    for a, ts in zip(areas, per_area):
        print(f"  {a[0]:<14} z{a[2]}-{a[3]:<3} {sum(t[2] for t in ts) / 1e6:8.1f} MB")
    if args.dry_run:
        return

    data, done = {}, 0
    groups = list(batches(tiles))

    def fetch(group):
        start = group[0][1]
        blob = src.get(start, group[-1][1] + group[-1][2] - start)
        return [(tid, blob[off - start:off - start + length]) for tid, off, length in group]

    with ThreadPoolExecutor(8) as pool:
        for got in pool.map(fetch, groups):
            for tid, b in got:
                data[tid] = b
            done += 1
            if done % 50 == 0 or done == len(groups):
                print(f"\r  downloaded {done}/{len(groups)} ranges, {src.bytes / 1e6:.0f} MB", end="", flush=True)
    print()
    meta = src.metadata()
    os.makedirs(args.out_dir, exist_ok=True)
    for a, ts in zip(areas, per_area):
        name = slug(a[0]) + ".pmtiles"
        path = os.path.join(ASSETS if a is LITE else args.out_dir, name)
        m = dict(meta, description=f"Tarang offline map: {a[0]} (Protomaps build {build})")
        size = write_archive(path, [(t[0], data[t[0]]) for t in ts], src.header, m, a)
        print(f"  wrote {path}: {len(ts)} tiles, {size / 1e6:.1f} MB")
    with open(os.path.join(args.out_dir, "index.json"), "w") as f:
        json.dump({"build": build, "attribution": meta.get("attribution", ""), "areas": index}, f, indent=1)
    write_styles(args.out_dir, index)
    fonts(os.path.join(args.out_dir, "fonts"), ALL_RANGES)
    if args.assets:
        fonts(os.path.join(ASSETS, "fonts"), LATIN_RANGES)
    print("wrote index.json, style.json and fonts/")


def write_styles(out_dir, index):
    """The same style for the Mac (out_dir) and the phone (APK assets); each fills in {MAPS} itself."""
    for d in (out_dir, ASSETS):
        with open(os.path.join(d, "style.json"), "w") as f:
            json.dump(style(index), f, separators=(",", ":"))


ALL_RANGES = range(0, 65536, 256)
LATIN_RANGES = (0, 256, 512, 768, 7680, 8192)  # Latin, Latin Extended, punctuation: enough for English labels


def fonts(out_dir, ranges):
    """The two label fonts (MapLibre glyph PBFs) from protomaps/basemaps-assets."""
    base = "https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts/"
    jobs = [(stack, f"{r}-{r + 255}") for stack in ("Noto Sans Regular", "Noto Sans Medium") for r in ranges]

    def get(job):
        stack, rng = job
        path = os.path.join(out_dir, stack, rng + ".pbf")
        if os.path.exists(path):
            return
        req = urllib.request.Request(base + urllib.parse.quote(f"{stack}/{rng}.pbf"), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(get, jobs))


if __name__ == "__main__":
    main()
