#!/usr/bin/env python3
"""Builds the offline outline map for the plane map (android/src/main/assets/basemap.bin).

Sources, both public domain:
  Natural Earth 1:10m GeoJSON (github.com/nvkelso/natural-earth-vector/tree/master/geojson):
    ne_10m_coastline, ne_10m_lakes, ne_10m_rivers_lake_centerlines, ne_10m_admin_0_boundary_lines_land,
    ne_10m_admin_1_states_provinces_lines, ne_10m_roads, ne_10m_populated_places_simple
  OurAirports (davidmegginson.github.io/ourairports-data): airports.csv, runways.csv

Usage: make_basemap.py <data dir> <out file>

Format (little-endian, varints are unsigned LEB128, coordinates are zigzag deltas in 1e-5 degrees):
  "TBM1", u8 layer count, then per layer: u8 id, u8 kind (0 lines, 1 points), varint feature count, then
  (ids with 0x10 set are coarse copies of the line layers, simplified to ~1.5 km, for low zoom)
  lines:  per feature  u8 min zoom, varint point count, (dlat, dlon) varint pairs
  points: per feature  u8 min zoom, varint lat, varint lon (zigzag, absolute), u8 name length, utf-8 name;
          sorted by min zoom, most important first
"""
import csv
import json
import math
import os
import sys

COAST, LAKE, RIVER, COUNTRY, STATE, ROAD, RUNWAY, CITY, AIRPORT = range(9)

# finer detail where the phone lives (North America and the Caribbean)
def detailed(lon, lat):
    return -170 <= lon <= -50 and 7 <= lat <= 75

def tolerance(lon, lat):
    return (60 if detailed(lon, lat) else 300) / 111_320  # metres -> degrees


def simplify(pts, tol):
    """Douglas-Peucker on (lon, lat), with longitude scaled by cos(latitude)."""
    if len(pts) <= 2:
        return pts
    k = math.cos(math.radians(sum(p[1] for p in pts) / len(pts)))
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a][0] * k, pts[a][1]
        bx, by = pts[b][0] * k, pts[b][1]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i][0] * k - ax, pts[i][1] - ay
            d = abs(px * dy - py * dx) / norm if norm > 0 else math.hypot(px, py)
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k2 in zip(pts, keep) if k2]


def lines_of(geom):
    if not geom:
        return []
    t, c = geom["type"], geom["coordinates"]
    if t == "LineString":
        return [c]
    if t == "MultiLineString":
        return c
    if t == "Polygon":
        return c
    if t == "MultiPolygon":
        return [ring for poly in c for ring in poly]
    return []


def varint(out, v):
    while True:
        b = v & 0x7F
        v >>= 7
        if v:
            out.append(b | 0x80)
        else:
            out.append(b)
            return


def zigzag(v):
    return (v << 1) ^ (v >> 63)


class Layer:
    def __init__(self, lid, kind):
        self.id, self.kind, self.features = lid, kind, []
        self.points = 0

    def add_line(self, coords, min_zoom):
        coords = [(float(p[0]), float(p[1])) for p in coords]
        if len(coords) < 2:
            return
        mid = coords[len(coords) // 2]
        pts = simplify(coords, tolerance(*mid))
        q = []
        for lon, lat in pts:
            p = (round(lat * 1e5), round(lon * 1e5))
            if not q or q[-1] != p:
                q.append(p)
        if len(q) < 2:
            return
        self.features.append((min_zoom, q))
        self.points += len(q)

    def coarse(self):
        """The same lines simplified to ~1.5 km, for the zoomed-out view."""
        c = Layer(self.id | 0x10, 0)
        for mz, q in self.features:
            lats, lons = [p[0] for p in q], [p[1] for p in q]
            if max(max(lats) - min(lats), max(lons) - min(lons)) < 3000:  # under ~3 km: invisible zoomed out
                continue
            if self.id == ROAD and mz > 6:
                continue
            pts = simplify([(lon / 1e5, lat / 1e5) for lat, lon in q], 1500 / 111_320)
            pts = [(round(lat * 1e5), round(lon * 1e5)) for lon, lat in pts]
            if len(pts) >= 2:
                c.features.append((mz, pts))
                c.points += len(pts)
        return c

    def add_point(self, lat, lon, min_zoom, name):
        self.features.append((min_zoom, (round(lat * 1e5), round(lon * 1e5)), name))

    def encode(self, out):
        out.append(self.id)
        out.append(self.kind)
        varint(out, len(self.features))
        for f in self.features:
            out.append(max(0, min(255, f[0])))
            if self.kind == 0:
                varint(out, len(f[1]))
                plat = plon = 0
                for lat, lon in f[1]:
                    varint(out, zigzag(lat - plat))
                    varint(out, zigzag(lon - plon))
                    plat, plon = lat, lon
            else:
                lat, lon = f[1]
                varint(out, zigzag(lat))
                varint(out, zigzag(lon))
                name = f[2].encode("utf-8")[:255]
                out.append(len(name))
                out.extend(name)


def features(data, name):
    with open(os.path.join(data, f"ne_10m_{name}.geojson"), encoding="utf-8") as f:
        return json.load(f)["features"]


def rank(props, key="scalerank", default=5):
    v = props.get(key)
    return int(v) if isinstance(v, (int, float)) else default


def main(data, out_path):
    layers = []

    coast = Layer(COAST, 0)
    for f in features(data, "coastline"):
        for line in lines_of(f["geometry"]):
            coast.add_line(line, 0)
    layers.append(coast)

    lakes = Layer(LAKE, 0)
    for f in features(data, "lakes"):
        r = rank(f["properties"])
        for ring in lines_of(f["geometry"]):
            mid = ring[len(ring) // 2]
            if detailed(*mid) or r <= 4:
                lakes.add_line(ring, max(2, r - 1))
    layers.append(lakes)

    rivers = Layer(RIVER, 0)
    for f in features(data, "rivers_lake_centerlines"):
        r = rank(f["properties"])
        for line in lines_of(f["geometry"]):
            mid = line[len(line) // 2]
            if detailed(*mid) or r <= 4:
                rivers.add_line(line, max(4, r))
    layers.append(rivers)

    countries = Layer(COUNTRY, 0)
    for f in features(data, "admin_0_boundary_lines_land"):
        for line in lines_of(f["geometry"]):
            countries.add_line(line, 0)
    layers.append(countries)

    states = Layer(STATE, 0)
    for f in features(data, "admin_1_states_provinces_lines"):
        p = f["properties"]
        for line in lines_of(f["geometry"]):
            mid = line[len(line) // 2]
            if detailed(*mid) or rank(p) <= 3:
                states.add_line(line, 3)
    layers.append(states)

    roads = Layer(ROAD, 0)
    for f in features(data, "roads"):
        p = f["properties"]
        if p.get("featurecla") != "Road" or p.get("type") not in ("Major Highway", "Secondary Highway"):
            continue
        major = p.get("type") == "Major Highway"
        na = p.get("continent") == "North America"
        if not (na or major):
            continue
        for line in lines_of(f["geometry"]):
            roads.add_line(line, max(5, min(10, rank(p) - 1)) if major else max(7, min(10, rank(p))))
    layers.append(roads)

    airports = Layer(AIRPORT, 1)
    kept = {}
    with open(os.path.join(data, "airports.csv"), encoding="utf-8") as f:
        for a in csv.DictReader(f):
            if a["type"] not in ("large_airport", "medium_airport"):
                continue
            label = a["iata_code"] or a["icao_code"] or a["ident"]
            mz = 6 if a["type"] == "large_airport" else 8
            airports.add_point(float(a["latitude_deg"]), float(a["longitude_deg"]), mz, label)
            kept[a["ident"]] = mz
    layers.append(airports)

    runways = Layer(RUNWAY, 0)
    with open(os.path.join(data, "runways.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["airport_ident"] not in kept or r["closed"] == "1":
                continue
            try:
                a = (float(r["le_longitude_deg"]), float(r["le_latitude_deg"]))
                b = (float(r["he_longitude_deg"]), float(r["he_latitude_deg"]))
            except ValueError:
                continue
            runways.features.append((9, [(round(a[1] * 1e5), round(a[0] * 1e5)), (round(b[1] * 1e5), round(b[0] * 1e5))]))
            runways.points += 2
    layers.append(runways)

    cities = Layer(CITY, 1)
    for f in features(data, "populated_places_simple"):
        p = f["properties"]
        if not f["geometry"]:
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        r = rank(p)
        if not detailed(lon, lat) and r > 6:
            continue
        cities.add_point(lat, lon, max(4, r + 1), p.get("name") or "")
    layers.append(cities)

    # most important first, so they win when labels collide
    for layer in (airports, cities):
        layer.features.sort(key=lambda f: f[0])

    layers += [l.coarse() for l in layers if l.kind == 0 and l.id in (COAST, LAKE, RIVER, COUNTRY, STATE, ROAD)]

    out = bytearray(b"TBM1")
    out.append(len(layers))
    for layer in layers:
        layer.encode(out)
        print(f"layer {layer.id}: {len(layer.features):6d} features {layer.points:8d} points", file=sys.stderr)
    with open(out_path, "wb") as f:
        f.write(out)
    print(f"{out_path}: {len(out) / 1e6:.2f} MB", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
