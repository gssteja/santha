import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Radio, RadarView, type Aircraft, type MapFocus, type RadioState } from '../../modules/rtl-radio';
import { C, mono } from '../theme';
import { Badge, Btn, Chip, s as ui } from '../ui';

type Sort = 'dist' | 'alt' | 'signal';

const EMERGENCY: Record<string, string> = { '7500': 'HIJACK', '7600': 'RADIO FAIL', '7700': 'EMERGENCY' };

// ADS-B emitter categories (set A-C, number 1-7)
const CATEGORY: Record<number, string> = {
  0xa1: 'Light aircraft', 0xa2: 'Small aircraft', 0xa3: 'Large aircraft', 0xa4: 'Large (B757)', 0xa5: 'Heavy',
  0xa6: 'High performance', 0xa7: 'Helicopter', 0xb1: 'Glider', 0xb2: 'Balloon', 0xb3: 'Parachutist', 0xb4: 'Ultralight',
  0xb6: 'Drone', 0xb7: 'Spacecraft', 0xc1: 'Emergency vehicle', 0xc2: 'Service vehicle', 0xc3: 'Obstacle',
};

export function fmtAlt(a: Aircraft): string {
  if (a.ground) return 'Ground';
  if (a.alt == null) return '—';
  return a.alt >= 18000 ? `FL${String(Math.round(a.alt / 100)).padStart(3, '0')}` : `${a.alt.toLocaleString()} ft`;
}

function name(a: Aircraft) {
  return a.flight || a.hex.toUpperCase();
}

function sortAircraft(list: Aircraft[], by: Sort): Aircraft[] {
  const out = [...list];
  if (by === 'alt') out.sort((a, b) => (b.alt ?? -1e9) - (a.alt ?? -1e9));
  else if (by === 'signal') out.sort((a, b) => b.rssi - a.rssi);
  else out.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9) || b.rssi - a.rssi);
  return out;
}

export function Planes({ s, bottom }: { s: RadioState; bottom: number }) {
  const [sel, setSel] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [sort, setSort] = useState<Sort>('dist');
  const asked = useRef(false);
  const p = s.planes;
  const tracking = s.running && s.appMode === 'planes' && s.status === 'radio';
  const list = useMemo(() => sortAircraft(p?.aircraft ?? [], sort), [p, sort]);
  const selected = sel ? (list.find((a) => a.hex === sel) ?? null) : null;

  // the phone's location centres the map and its range rings; ask the first time the tab opens
  useEffect(() => {
    if (s.receiver || asked.current) return;
    asked.current = true;
    Radio.locate()
      .then((loc) => loc && setFocus({ lat: loc.lat, lon: loc.lon, zoom: 8, token: Date.now() }))
      .catch(() => {});
  }, [s.receiver]);

  const centreMe = async () => {
    const loc = (await Radio.locate(true).catch(() => null)) ?? s.receiver;
    if (loc) setFocus({ lat: loc.lat, lon: loc.lon, token: Date.now() });
  };

  const show = (a: Aircraft) => {
    setSel(a.hex);
    if (a.lat != null && a.lon != null) setFocus({ lat: a.lat, lon: a.lon, token: Date.now() });
  };

  const status = !s.running
    ? 'Off'
    : !tracking
      ? s.status === 'error'
        ? s.error
        : 'Starting the plane tracker…'
      : p
        ? `${p.tracked} aircraft · ${p.withPos} on map · ${Math.round(p.rate)} msg/s`
        : 'Listening on 1090 MHz…';

  return (
    <View style={{ flex: 1 }}>
      <View style={st.mapWrap}>
        <RadarView style={StyleSheet.absoluteFill} selected={sel} focus={focus} onSelect={(e) => setSel(e.nativeEvent.hex || null)} />
        <View style={st.status} pointerEvents="none">
          <View style={[st.dot, { backgroundColor: tracking ? C.ok : s.status === 'error' ? C.danger : C.muted }]} />
          <Text style={st.statusText} numberOfLines={1}>
            {status}
          </Text>
        </View>
        <Pressable style={st.meBtn} onPress={centreMe} hitSlop={6}>
          <Text style={st.meIcon}>◎</Text>
        </Pressable>
        {!s.running && (
          <View style={st.overlay} pointerEvents="none">
            <Text style={st.overlayTitle}>Tap Start to track planes</Text>
            <Text style={st.overlayText}>
              Aircraft broadcast their position on 1090 MHz (ADS-B). Shorten the telescopic antenna to about 7 cm and keep the phone
              near a window: planes need line of sight. The radio pauses while this tab is open.
            </Text>
          </View>
        )}
      </View>
      {selected && <Detail a={selected} onShow={() => show(selected)} onClose={() => setSel(null)} />}
      <FlatList
        style={{ flex: 1 }}
        data={list}
        keyExtractor={(a) => a.hex}
        contentContainerStyle={{ paddingBottom: bottom }}
        ListHeaderComponent={
          <View style={st.listHead}>
            <Chip label="Nearest" on={sort === 'dist'} onPress={() => setSort('dist')} />
            <Chip label="Highest" on={sort === 'alt'} onPress={() => setSort('alt')} />
            <Chip label="Strongest" on={sort === 'signal'} onPress={() => setSort('signal')} />
          </View>
        }
        ListEmptyComponent={
          tracking ? (
            <Text style={st.empty}>
              Listening on 1090 MHz… no aircraft yet. Near an airport you should see some within a minute; indoors, a window helps a lot.
            </Text>
          ) : null
        }
        renderItem={({ item: a }) => (
          <Pressable style={[st.row, a.hex === sel && { backgroundColor: C.accentDim }]} onPress={() => show(a)}>
            <View style={{ flex: 1 }}>
              <Text style={st.flight} numberOfLines={1}>
                {name(a)}
                {a.squawk && EMERGENCY[a.squawk] ? <Text style={{ color: C.danger }}>{`  ${EMERGENCY[a.squawk]}`}</Text> : null}
              </Text>
              <Text style={st.sub} numberOfLines={1}>
                {[a.flight ? a.hex.toUpperCase() : null, a.squawk ? `sq ${a.squawk}` : null, a.lat == null ? 'no position' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <View style={st.col}>
              <Text style={st.val}>{fmtAlt(a)}</Text>
              <Text style={st.sub}>{a.vr != null && Math.abs(a.vr) >= 300 ? `${a.vr > 0 ? '↑' : '↓'} ${Math.abs(a.vr).toLocaleString()}` : ' '}</Text>
            </View>
            <View style={st.colSm}>
              <Text style={st.val}>{a.gs != null ? `${Math.round(a.gs)} kt` : '—'}</Text>
              <Text style={st.sub}>{a.track != null ? `${Math.round(a.track)}°` : ' '}</Text>
            </View>
            <View style={st.colSm}>
              <Text style={st.val}>{a.dist != null ? `${a.dist.toFixed(a.dist < 10 ? 1 : 0)} nm` : '—'}</Text>
              <Text style={st.sub}>{a.seen < 1.5 ? 'now' : `${Math.round(a.seen)} s`}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

function Detail({ a, onShow, onClose }: { a: Aircraft; onShow: () => void; onClose: () => void }) {
  const emergency = a.squawk ? EMERGENCY[a.squawk] : undefined;
  const cells: [string, string][] = [
    ['Altitude', fmtAlt(a)],
    ['Climb', a.vr != null ? `${a.vr > 0 ? '+' : ''}${a.vr.toLocaleString()} ft/min` : '—'],
    ['Speed', a.gs != null ? `${Math.round(a.gs)} kt` : '—'],
    ['Track', a.track != null ? `${Math.round(a.track)}°` : a.heading != null ? `hdg ${Math.round(a.heading)}°` : '—'],
    ['Distance', a.dist != null ? `${a.dist.toFixed(1)} nm @ ${String(Math.round(a.bearing ?? 0)).padStart(3, '0')}°` : '—'],
    ['Signal', `${a.rssi.toFixed(1)} dBFS · ${a.messages} msgs`],
  ];
  return (
    <View style={st.detail}>
      <View style={[ui.row, { gap: 8 }]}>
        <Text style={st.detailName}>{name(a)}</Text>
        <Badge text={a.hex.toUpperCase()} color={C.accent} />
        {a.squawk && <Badge text={`SQ ${a.squawk}`} color={emergency ? C.danger : C.muted} />}
        <View style={{ flex: 1 }} />
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={[ui.muted, { fontSize: 18 }]}>✕</Text>
        </Pressable>
      </View>
      {(emergency || CATEGORY[a.category]) && (
        <Text style={[st.sub, emergency && { color: C.danger, fontWeight: '700' }]}>
          {[emergency, CATEGORY[a.category]].filter(Boolean).join(' · ')}
        </Text>
      )}
      <View style={st.grid}>
        {cells.map(([k, v]) => (
          <View key={k} style={st.cell}>
            <Text style={st.cellKey}>{k}</Text>
            <Text style={st.cellVal} numberOfLines={1}>
              {v}
            </Text>
          </View>
        ))}
      </View>
      <View style={[ui.row, { gap: 8 }]}>
        <Btn label="Show on map" small disabled={a.lat == null} onPress={onShow} />
        <Btn label="Look up online ↗" small onPress={() => Linking.openURL(`https://globe.adsbexchange.com/?icao=${a.hex.replace('~', '')}`)} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  mapWrap: { height: '52%', overflow: 'hidden', backgroundColor: '#0e1116', borderBottomWidth: 1, borderBottomColor: C.line },
  status: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: {
    color: C.text,
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(10,13,17,0.78)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  meBtn: {
    position: 'absolute',
    top: 8,
    right: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(18,24,33,0.9)',
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meIcon: { color: C.accent, fontSize: 22, marginTop: -2 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,15,20,0.72)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  overlayTitle: { color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  overlayText: { color: C.muted, textAlign: 'center', lineHeight: 19 },
  listHead: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  empty: { color: C.muted, paddingHorizontal: 16, paddingTop: 8, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line },
  flight: { color: C.text, fontSize: 15, fontWeight: '700', fontFamily: mono },
  sub: { color: C.muted, fontSize: 11, marginTop: 1 },
  col: { width: 82, alignItems: 'flex-end' },
  colSm: { width: 60, alignItems: 'flex-end' },
  val: { color: C.text, fontSize: 13, fontFamily: mono },
  detail: { backgroundColor: C.panel, padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  detailName: { color: C.text, fontSize: 20, fontWeight: '800', fontFamily: mono },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
  cell: { width: '50%', paddingRight: 8 },
  cellKey: { color: C.muted, fontSize: 11 },
  cellVal: { color: C.text, fontSize: 14, fontFamily: mono },
});
