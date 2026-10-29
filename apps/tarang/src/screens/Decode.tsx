import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Radio, type AcarsMessage, type AprsStation, type RadioState, type WeatherAlert } from '../../modules/rtl-radio';
import { C, mono } from '../theme';
import { Badge, Btn, Card, Chip, SectionTitle, s as ui } from '../ui';
import { Sensors } from './Sensors';
import { Trunk } from './Trunk';

export type DecodeMode = 'sensors' | 'weather' | 'aprs' | 'acars' | 'p25';

const MODES: { id: DecodeMode; name: string }[] = [
  { id: 'p25', name: 'P25 trunk' },
  { id: 'weather', name: 'Weather alerts' },
  { id: 'aprs', name: 'APRS' },
  { id: 'acars', name: 'ACARS' },
  { id: 'sensors', name: 'Sensors' },
];

function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const day = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

/** Re-render every second, for "x s ago" labels. */
function useTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

export function Decode({ s, mode, setMode, bottom }: { s: RadioState; mode: DecodeMode; setMode: (m: DecodeMode) => void; bottom: number }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={st.modes}>
        {MODES.map((m) => (
          <Chip key={m.id} label={m.name} on={mode === m.id} onPress={() => setMode(m.id)} />
        ))}
      </View>
      {mode === 'sensors' && <Sensors s={s} bottom={bottom} />}
      {mode === 'weather' && <Weather s={s} bottom={bottom} />}
      {mode === 'aprs' && <Aprs s={s} bottom={bottom} />}
      {mode === 'acars' && <Acars s={s} bottom={bottom} />}
      {mode === 'p25' && <Trunk s={s} bottom={bottom} />}
    </View>
  );
}

function status(s: RadioState, mode: string): string | null {
  if (!s.running) return 'Tap Start to begin.';
  if (s.appMode !== mode || s.status === 'starting') return 'Starting…';
  if (s.status === 'error') return s.error;
  return null;
}

function ListenToggle({ s }: { s: RadioState }) {
  const on = !!s.decode?.listen;
  return <Btn label={on ? '🔊 Listening' : '🔇 Muted'} small active={on} onPress={() => Radio.command({ action: 'decode_listen', on: !on })} />;
}

// ---------- NOAA weather alerts ----------

const LEVEL_COLOR: Record<WeatherAlert['level'], string> = { warning: C.danger, watch: C.amber, statement: C.accent, test: C.muted };

function Weather({ s, bottom }: { s: RadioState; bottom: number }) {
  useTick();
  const w = s.decode?.weather;
  const st0 = status(s, 'weather');
  const best = w?.stations.find((x) => x.f === w.freq);
  const [picking, setPicking] = useState(false);
  const header = (
    <>
      <Card>
        <SectionTitle>NOAA weather alerts</SectionTitle>
        <Text style={[ui.muted, { lineHeight: 19 }]}>
          Listens to the strongest NOAA Weather Radio station (162.40–162.55 MHz) and decodes the SAME data burst that starts every
          warning and watch. Alerts for your county pop up as a notification and play the broadcast, even with the screen off. The
          stations also send a Required Weekly Test, usually Wednesday late morning.
        </Text>
        {w && !w.available ? (
          <Text style={[st.warn, { marginTop: 10 }]}>NOAA Weather Radio only broadcasts in the US and Canada, so there are no alerts to decode here.</Text>
        ) : st0 ? (
          <Text style={[st.warn, { marginTop: 10 }]}>{st0}</Text>
        ) : (
          <View style={[ui.row, { gap: 8, marginTop: 12 }]}>
            <View style={{ flex: 1 }}>
              <Text style={st.big}>{w ? `${(w.freq / 1e6).toFixed(3)} MHz` : '—'}</Text>
              <Text style={[ui.muted, { fontSize: 12 }]}>
                {best ? `${best.snr.toFixed(0)} dB` : ''}
                {w?.tone ? ' · alert tone' : ''}
                {w?.alerting ? ' · playing alert' : ''}
              </Text>
            </View>
            <ListenToggle s={s} />
          </View>
        )}
        {w && (
          <View style={st.bars}>
            {w.stations.map((x) => (
              <View key={x.f} style={st.barCol}>
                <View style={st.barTrack}>
                  <View
                    style={[st.barFill, { height: `${Math.max(4, Math.min(100, (x.snr / 40) * 100))}%`, backgroundColor: x.f === w.freq ? C.accent : C.line }]}
                  />
                </View>
                <Text style={st.barText}>{((x.f / 1e6) % 1).toFixed(3).slice(1)}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={[ui.row, { gap: 8, marginTop: 12 }]}>
          <Text style={[ui.text, { flex: 1 }]} numberOfLines={2}>
            {w?.county ? `Your county: ${w.county.name}${w.county.manual ? '' : ' (from your location)'}` : 'County unknown: every alert notifies'}
          </Text>
          <Btn label={picking ? 'Done' : 'Change'} small onPress={() => setPicking(!picking)} />
        </View>
        {picking && (
          <View style={st.counties}>
            <Chip
              label="Locate me"
              on={!!w?.county && !w.county.manual}
              onPress={() =>
                Radio.locate(true)
                  .catch(() => null)
                  .then(() => Radio.command({ action: 'wx_county', fips: null }))
              }
            />
            {Radio.nearbyCounties().map((c) => (
              <Chip
                key={c.fips}
                label={c.name}
                on={!!w?.county?.manual && w.county.fips === c.fips}
                onPress={() => Radio.command({ action: 'wx_county', fips: c.fips })}
              />
            ))}
          </View>
        )}
      </Card>
      {w && w.alerts.length > 0 && (
        <View style={[ui.row, { marginHorizontal: 16, marginTop: 14, marginBottom: 2 }]}>
          <Text style={[ui.h2, { flex: 1, marginBottom: 0 }]}>Alerts heard</Text>
          <Btn label="Clear" small onPress={() => Radio.command({ action: 'decode_clear', what: 'weather' })} />
        </View>
      )}
    </>
  );
  return (
    <FlatList
      data={w?.alerts ?? []}
      keyExtractor={(a) => `${a.received}-${a.raw}`}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: bottom }}
      ListEmptyComponent={!st0 ? <Text style={st.empty}>No alerts yet. That's good news.</Text> : null}
      renderItem={({ item: a }) => (
        <Card style={{ borderColor: a.mine && a.level !== 'test' ? LEVEL_COLOR[a.level] : C.line }}>
          <View style={[ui.row, { gap: 8 }]}>
            <Text style={[st.event, { color: LEVEL_COLOR[a.level] }]} numberOfLines={1}>
              {a.event}
            </Text>
            {a.mine && <Badge text="YOUR COUNTY" color={LEVEL_COLOR[a.level]} />}
          </View>
          <Text style={[ui.text, { marginTop: 4 }]}>{a.places.join(', ')}</Text>
          <Text style={[ui.muted, { fontSize: 12, marginTop: 4 }]}>
            {`${day(a.issued)} ${clock(a.issued)} – ${clock(a.expires)} · ${a.org} · ${a.station}`}
          </Text>
          <Text style={st.raw} numberOfLines={2}>{`${(a.freq / 1e6).toFixed(3)} MHz · heard ${ago(a.received)} · ${a.raw}`}</Text>
        </Card>
      )}
    />
  );
}

// ---------- APRS ----------

// the commonest APRS symbols (by symbol code; both tables mostly agree on the everyday ones)
const SYMBOL: Record<string, string> = {
  '>': '🚗', k: '🛻', u: '🚚', j: '🚙', v: '🚐', R: '🚐', b: '🚲', '<': '🏍', '[': '🚶', Y: '⛵', s: '🚤', '^': '✈', "'": '🛩',
  X: '🚁', O: '🎈', '-': '🏠', _: '🌤', '#': '📡', '&': '📶', r: '📡', y: '📡', f: '🚒', a: '🚑', P: '🚓', U: '🚌', '=': '🚆',
};

function wxText(w: Record<string, number>): string {
  const p: string[] = [];
  if (w.tempF != null) p.push(`${w.tempF.toFixed(0)} °F`);
  if (w.humidity != null) p.push(`${w.humidity.toFixed(0)}% RH`);
  if (w.windMph != null) p.push(`wind ${w.windMph.toFixed(0)} mph${w.windDir != null ? ` from ${w.windDir.toFixed(0)}°` : ''}`);
  if (w.gustMph != null) p.push(`gust ${w.gustMph.toFixed(0)}`);
  if (w.pressureMb != null) p.push(`${w.pressureMb.toFixed(1)} mb`);
  if (w.rainTodayIn != null) p.push(`rain ${w.rainTodayIn.toFixed(2)} in today`);
  return p.join(' · ');
}

function Aprs({ s, bottom }: { s: RadioState; bottom: number }) {
  useTick();
  const a = s.decode?.aprs;
  const st0 = status(s, 'aprs');
  const header = (
    <Card>
      <SectionTitle>{`APRS on ${a ? (a.freq / 1e6).toFixed(3) : '144.390'} MHz`}</SectionTitle>
      <Text style={[ui.muted, { lineHeight: 19 }]}>
        Ham radio's automatic position network: cars, home stations, weather stations and digipeaters beacon where they are, plus
        short messages. Use the longer antenna (about 50 cm per side). Mobile stations beacon every minute or two, fixed ones every
        10–30 minutes.
      </Text>
      {st0 ? (
        <Text style={[st.warn, { marginTop: 10 }]}>{st0}</Text>
      ) : (
        <View style={[ui.row, { gap: 8, marginTop: 12 }]}>
          <Text style={[ui.text, { flex: 1 }]}>{a ? `${a.stations.length} stations · ${a.packets} packets · ${s.snr.toFixed(0)} dB` : ''}</Text>
          <ListenToggle s={s} />
          {a && a.packets > 0 && <Btn label="Clear" small onPress={() => Radio.command({ action: 'decode_clear', what: 'aprs' })} />}
        </View>
      )}
      {a && a.log.length > 0 && (
        <View style={{ marginTop: 10, gap: 4 }}>
          {a.log.slice(0, 5).map((l, i) => (
            <Text key={i} style={[ui.muted, { fontSize: 12 }]} numberOfLines={2}>
              <Text style={{ color: C.text, fontFamily: mono }}>{l.from}</Text>
              {l.kind === 'message' ? ` → ${l.to}: ` : ': '}
              {l.text}
            </Text>
          ))}
        </View>
      )}
    </Card>
  );
  return (
    <FlatList
      data={a?.stations ?? []}
      keyExtractor={(x) => x.call}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: bottom }}
      ListEmptyComponent={!st0 ? <Text style={st.empty}>Listening… no packets yet.</Text> : null}
      renderItem={({ item }) => <Station x={item} />}
    />
  );
}

function Station({ x }: { x: AprsStation }) {
  const sym = x.symbol ? (SYMBOL[x.symbol[1]] ?? '📍') : '📍';
  const motion = [
    x.speedMph != null && x.speedMph > 0 ? `${x.speedMph} mph` : null,
    x.course != null && x.speedMph ? `${x.course}°` : null,
    x.altFt != null ? `${x.altFt.toLocaleString()} ft` : null,
  ].filter(Boolean);
  return (
    <View style={st.row}>
      <Text style={st.sym}>{sym}</Text>
      <View style={{ flex: 1 }}>
        <View style={[ui.row, { gap: 8 }]}>
          <Text style={st.call} numberOfLines={1}>
            {x.call}
          </Text>
          <Text style={[ui.muted, { fontSize: 12 }]}>{ago(x.last)}</Text>
        </View>
        {x.weather && Object.keys(x.weather).length > 0 && <Text style={[ui.text, { fontSize: 13 }]}>{wxText(x.weather)}</Text>}
        {!!(x.comment || x.status) && (
          <Text style={[ui.muted, { fontSize: 12 }]} numberOfLines={2}>
            {x.comment || x.status}
          </Text>
        )}
        <Text style={st.meta} numberOfLines={1}>
          {[
            x.dist != null ? `${x.dist.toFixed(x.dist < 10 ? 1 : 0)} mi ${compass(x.bearing ?? 0)}` : x.lat == null ? 'no position' : null,
            ...motion,
            x.via === 'direct' ? 'heard direct' : `via ${x.via}`,
            `${x.count} pkt${x.count === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </View>
  );
}

const compass = (b: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8];

// ---------- ACARS ----------

const NOISE = new Set(['_d', 'Q0', 'SA']);

function Acars({ s, bottom }: { s: RadioState; bottom: number }) {
  useTick();
  const a = s.decode?.acars;
  const st0 = status(s, 'acars');
  const [all, setAll] = useState(false);
  const list = useMemo(() => (a?.messages ?? []).filter((m) => all || (!NOISE.has(m.label) && m.text.trim() !== '')), [a, all]);
  const header = (
    <Card>
      <SectionTitle>ACARS aircraft messages</SectionTitle>
      <Text style={[ui.muted, { lineHeight: 19 }]}>
        The text datalink between airliners and their airlines: position and fuel reports, weather, gate and crew messages, on{' '}
        {(a?.channels ?? [130.025e6, 130.45e6, 131.125e6, 131.55e6]).map((f) => (f / 1e6).toFixed(3)).join(', ')} MHz at once. Busy
        near an airport; use the antenna at about 55 cm per side.
      </Text>
      {st0 ? (
        <Text style={[st.warn, { marginTop: 10 }]}>{st0}</Text>
      ) : (
        <View style={[ui.row, { gap: 8, marginTop: 12 }]}>
          <Text style={[ui.text, { flex: 1 }]}>{a ? `${a.count} messages` : ''}</Text>
          <Chip label="Show keep-alives" on={all} onPress={() => setAll(!all)} />
          {a && a.count > 0 && <Btn label="Clear" small onPress={() => Radio.command({ action: 'decode_clear', what: 'acars' })} />}
        </View>
      )}
    </Card>
  );
  return (
    <FlatList
      data={list}
      keyExtractor={(m, i) => `${m.t}-${i}`}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: bottom }}
      ListEmptyComponent={!st0 ? <Text style={st.empty}>Listening… nothing decoded yet.</Text> : null}
      renderItem={({ item }) => <AcarsRow m={item} />}
    />
  );
}

function AcarsRow({ m }: { m: AcarsMessage }) {
  return (
    <View style={st.row}>
      <View style={{ flex: 1 }}>
        <View style={[ui.row, { gap: 8 }]}>
          <Text style={st.call}>{m.flight || m.reg || '—'}</Text>
          {m.flight && m.reg ? <Text style={[ui.muted, { fontFamily: mono, fontSize: 12 }]}>{m.reg}</Text> : null}
          <Text style={[ui.muted, { fontSize: 12, flex: 1, textAlign: 'right' }]}>{ago(m.t)}</Text>
        </View>
        <Text style={st.meta}>
          {[m.down ? '↓ from aircraft' : '↑ to aircraft', `label ${m.label}${m.labelName ? ` (${m.labelName})` : ''}`, `${m.freq.toFixed(3)} MHz`].join(' · ')}
        </Text>
        {!!m.text.trim() && <Text style={st.acarsText}>{m.text.trim()}</Text>}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingTop: 10 },
  counties: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  warn: { color: C.amber, fontSize: 12 },
  empty: { color: C.muted, paddingHorizontal: 16, paddingTop: 14 },
  big: { color: C.text, fontSize: 22, fontFamily: mono },
  bars: { flexDirection: 'row', gap: 6, marginTop: 12, height: 54 },
  barCol: { flex: 1, alignItems: 'center', gap: 3 },
  barTrack: { flex: 1, width: '70%', backgroundColor: C.panel2, borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 4 },
  barText: { color: C.muted, fontSize: 10, fontFamily: mono },
  event: { fontSize: 16, fontWeight: '800', flex: 1 },
  raw: { color: C.muted, fontSize: 10, fontFamily: mono, marginTop: 6 },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line },
  sym: { fontSize: 22, width: 30, textAlign: 'center', marginTop: 1 },
  call: { color: C.text, fontSize: 15, fontWeight: '700', fontFamily: mono },
  meta: { color: C.muted, fontSize: 11, marginTop: 2 },
  acarsText: { color: C.text, fontSize: 12, fontFamily: mono, marginTop: 4, lineHeight: 17 },
});
