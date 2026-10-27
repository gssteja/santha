import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Radio, SweepView, type RadioState, type TuneEvent } from '../../modules/rtl-radio';
import { bandName } from '../bandplan';
import { bandMode, fmtBw, fmtMHz } from '../format';
import { presetLabel } from '../presets';
import { C, mono } from '../theme';
import { Btn, Card, Chip, SectionTitle, s as ui } from '../ui';

const RANGES = [
  { id: 'all', name: 'Everything', start: 24, stop: 1700, note: '24–1700 MHz, about a minute' },
  { id: 'air', name: 'Airband', start: 118, stop: 137, note: '118–137 MHz' },
  { id: 'vhf', name: 'VHF', start: 136, stop: 174, note: '136–174 MHz: weather, ham, marine, business' },
  { id: 'uhf', name: 'UHF', start: 400, stop: 512, note: '400–512 MHz: walkie-talkies, business, public safety' },
  { id: 'fm', name: 'FM', start: 88, stop: 108, note: 'FM broadcast' },
  { id: 'hf', name: 'HF', start: 0.1, stop: 24, note: '0.1–24 MHz, needs a long wire antenna' },
];

export function Survey({ s, bottom }: { s: RadioState; bottom: number }) {
  const [range, setRange] = useState(RANGES[0]);
  const sweeping = s.scan?.state === 'sweep';
  const result = s.sweep;

  const onTune = useCallback((e: TuneEvent) => {
    const f = Math.round(e.nativeEvent.freq / 5000) * 5000;
    Radio.command({ action: 'tune', f, ...(bandMode(f) ? { mode: bandMode(f)! } : {}) });
  }, []);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: bottom }}>
      <Card>
        <SectionTitle>Band activity survey</SectionTitle>
        <Text style={[ui.muted, { marginBottom: 10, lineHeight: 19 }]}>
          Sweeps a range in 1.9 MHz steps and charts every signal it hears, like rtl_power. Tap the chart or a signal to listen.
        </Text>
        <View style={st.ranges}>
          {RANGES.map((r) => (
            <Chip key={r.id} label={r.name} on={r.id === range.id} onPress={() => setRange(r)} />
          ))}
        </View>
        <Text style={[ui.muted, { marginTop: 8, fontSize: 12 }]}>{range.note}</Text>
        <View style={[ui.row, { gap: 8, marginTop: 12 }]}>
          {sweeping ? (
            <Btn label="■ Stop" danger onPress={() => Radio.command({ action: 'scan_stop' })} />
          ) : (
            <Btn label="Run survey" primary disabled={!s.running} onPress={() => Radio.command({ action: 'sweep', start: range.start, stop: range.stop })} />
          )}
          <Text style={[ui.muted, { flex: 1 }]} numberOfLines={1}>
            {sweeping ? `Sweeping ${s.scan!.name}… ${s.scan!.progress}` : result ? `Last: ${fmtMHz(result.start)}–${fmtMHz(result.stop)} MHz, ${result.peaks.length} signals` : ''}
          </Text>
        </View>
        {!s.running && <Text style={[st.warn, { marginTop: 8 }]}>Start the radio to run a survey.</Text>}
      </Card>
      <View style={st.chartWrap}>
        <SweepView style={st.chart} onTune={onTune} />
        {!result && !sweeping && (
          <View style={st.empty} pointerEvents="none">
            <Text style={ui.muted}>Run a survey to chart the band</Text>
          </View>
        )}
      </View>
      {result && result.peaks.length > 0 && (
        <Card>
          <SectionTitle>Strongest signals</SectionTitle>
          {result.peaks.map((p) => {
            const name = p.label || presetLabel(p.f) || bandName(p.f);
            return (
              <Pressable key={p.f} style={st.peak} onPress={() => Radio.command({ action: 'tune', f: p.f, mode: p.mode })}>
                <Text style={st.peakF}>{fmtMHz(p.f)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={ui.text} numberOfLines={1}>
                    {name || 'Unknown'}
                  </Text>
                  <Text style={[ui.muted, { fontSize: 11 }]}>{`${p.mode} · ${fmtBw(p.width)} wide`}</Text>
                </View>
                <Text style={[st.snr, { color: p.snr >= 25 ? C.ok : p.snr >= 15 ? C.amber : C.muted }]}>{`${p.snr.toFixed(0)} dB`}</Text>
              </Pressable>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  ranges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  warn: { color: C.amber, fontSize: 12 },
  chartWrap: { marginHorizontal: 12, marginTop: 10, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  chart: { height: 180, backgroundColor: '#0a0d11' },
  empty: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  peak: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line },
  peakF: { color: C.text, fontFamily: mono, width: 86, fontSize: 14 },
  snr: { fontFamily: mono, width: 48, textAlign: 'right' },
});
