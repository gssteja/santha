import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { Radio, type RadioState, type SensorDevice } from '../../modules/rtl-radio';
import { useRegion } from '../region';
import { C, mono } from '../theme';
import { Btn, Card, SectionTitle, s as ui } from '../ui';

const c2f = (v: number) => (v * 9) / 5 + 32;

// readings rtl_433 reports under well-known keys, as on the Mac panel
const FMT: [RegExp, (v: number) => string][] = [
  [/^temperature(_\d)?_C$/, (v) => `${c2f(v).toFixed(1)} °F (${v.toFixed(1)} °C)`],
  [/^temperature(_\d)?_F$/, (v) => `${v.toFixed(1)} °F`],
  [/^humidity(_\d)?$/, (v) => `${v}% humidity`],
  [/^pressure_kPa$/, (v) => `${(v * 0.145038).toFixed(1)} psi (${v.toFixed(0)} kPa)`],
  [/^pressure_PSI$/, (v) => `${v.toFixed(1)} psi`],
  [/^pressure_hPa$/, (v) => `${v.toFixed(1)} hPa`],
  [/^battery_ok$/, (v) => (v ? 'battery OK' : 'battery LOW')],
  [/^wind_avg_km_h$/, (v) => `wind ${(v / 1.609).toFixed(1)} mph`],
  [/^wind_max_km_h$/, (v) => `gust ${(v / 1.609).toFixed(1)} mph`],
  [/^wind_avg_m_s$/, (v) => `wind ${(v * 2.237).toFixed(1)} mph`],
  [/^wind_max_m_s$/, (v) => `gust ${(v * 2.237).toFixed(1)} mph`],
  [/^wind_avg_mi_h$/, (v) => `wind ${v.toFixed(1)} mph`],
  [/^wind_max_mi_h$/, (v) => `gust ${v.toFixed(1)} mph`],
  [/^wind_dir_deg$/, (v) => `from ${v}°`],
  [/^rain_mm$/, (v) => `rain ${(v / 25.4).toFixed(2)} in`],
  [/^rain_in$/, (v) => `rain ${v.toFixed(2)} in`],
  [/^moisture$/, (v) => `${v}% moisture`],
  [/^light_lux$/, (v) => `${v.toLocaleString()} lux`],
  [/^uv$/, (v) => `UV ${v}`],
  [/^power_W$/, (v) => `${v} W`],
];

function fmtReading(k: string, v: number | string | boolean): string {
  if (typeof v === 'number' || typeof v === 'boolean') {
    const f = FMT.find(([re]) => re.test(k));
    if (f) return f[1](Number(v));
  }
  return `${k.replace(/_/g, ' ')}: ${v}`;
}

function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
}

const mhz = (hz: number) => (hz / 1e6).toFixed(hz % 1e6 ? 2 : 0);

export function Sensors({ s, bottom }: { s: RadioState; bottom: number }) {
  const z = s.sensors;
  const listening = s.running && s.appMode === 'sensors' && s.status === 'radio';
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000); // "last heard" and the hop countdown
    return () => clearInterval(t);
  }, []);
  const devices = z?.devices ?? [];
  const hopIn = z?.nextHop ? Math.max(0, Math.round((z.nextHop - Date.now()) / 1000)) : null;

  const { region } = useRegion();
  const bands = z?.bands ?? region.sensor_bands;
  const hops = bands.map((b) => mhz(b)).join(bands.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1');
  const header = (
    <Card>
      <SectionTitle>
        Wireless sensors nearby
        <Text style={[ui.muted, { fontWeight: '400' }]}>{z && devices.length ? `  ${devices.length} devices · ${z.messages} messages` : ''}</Text>
      </SectionTitle>
      <Text style={[ui.muted, { lineHeight: 19 }]}>
        Decodes {z?.decoders ? `${z.decoders}` : '200+'} kinds of devices with rtl_433: weather stations, pool and fridge
        thermometers, car tire-pressure sensors, doorbells, remotes. {bands.length > 1 ? `It hops between ${hops} MHz every 40 s` : `It listens on ${hops} MHz`} ({region.name}). Use the
        small 433 MHz antenna. Most sensors transmit every 30-60 s, so give it a few minutes. The radio pauses while this tab is
        open.
      </Text>
      <View style={st.bands}>
        {bands.map((b) => {
          const on = listening && z?.band === b;
          return (
            <View key={b} style={[st.band, on && { borderColor: C.accent, backgroundColor: C.accentDim }]}>
              <Text style={[st.bandText, on && { color: C.accent }]}>{`${mhz(b)} MHz`}</Text>
            </View>
          );
        })}
        <Text style={[ui.muted, { flex: 1, fontSize: 12 }]} numberOfLines={1}>
          {!s.running ? 'Off' : !listening ? (s.status === 'error' ? s.error : 'Starting…') : hopIn != null ? `next hop in ${hopIn} s` : ''}
        </Text>
        {devices.length > 0 && <Btn label="Clear" small onPress={() => Radio.command({ action: 'sensors_clear' })} />}
      </View>
      {!s.running && <Text style={[st.warn, { marginTop: 8 }]}>Tap Start to listen for sensors.</Text>}
    </Card>
  );

  return (
    <FlatList
      data={devices}
      keyExtractor={(d) => d.key}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: bottom }}
      ListEmptyComponent={listening ? <Text style={st.empty}>Listening… nothing decoded yet.</Text> : null}
      renderItem={({ item }) => <Device d={item} />}
    />
  );
}

function Device({ d }: { d: SensorDevice }) {
  const readings = Object.entries(d.readings).map(([k, v]) => fmtReading(k, v));
  const fresh = Date.now() - d.last < 90_000;
  return (
    <Card style={{ paddingVertical: 11 }}>
      <View style={[ui.row, { gap: 8 }]}>
        <View style={[st.light, fresh && { backgroundColor: C.ok }]} />
        <Text style={st.model} numberOfLines={1}>
          {d.model}
        </Text>
        <Text style={[ui.muted, { fontSize: 12 }]}>{ago(d.last)}</Text>
      </View>
      <Text style={st.meta} numberOfLines={1}>
        {[
          d.id !== '' ? `id ${d.id}` : null,
          d.channel !== '' ? `ch ${d.channel}` : null,
          d.freq ? `${d.freq.toFixed(2)} MHz` : null,
          d.snr != null ? `${d.snr.toFixed(0)} dB` : null,
          `${d.count} msg${d.count === 1 ? '' : 's'}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {readings.length > 0 && (
        <View style={st.readings}>
          {readings.map((r, i) => (
            <View key={i} style={st.reading}>
              <Text style={st.readingText}>{r}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const st = StyleSheet.create({
  bands: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  band: { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  bandText: { color: C.muted, fontSize: 12, fontFamily: mono },
  warn: { color: C.amber, fontSize: 12 },
  empty: { color: C.muted, paddingHorizontal: 16, paddingTop: 14 },
  light: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.line },
  model: { color: C.text, fontSize: 15, fontWeight: '700', flex: 1 },
  meta: { color: C.muted, fontSize: 12, marginTop: 3, fontFamily: mono },
  readings: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  reading: { backgroundColor: C.panel2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: C.line },
  readingText: { color: C.text, fontSize: 13 },
});
