import { memo, useCallback } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Radio, SpectrumView, type Mode, type RadioState, type TuneEvent, type VfoB } from '../../modules/rtl-radio';
import { BW_STEP, DEFAULT_BW, FINE_SNAP, MODES, SNAP, bandMode, fmtBw, fmtDuration, fmtMHz, snap } from '../format';
import { presetLabel } from '../presets';
import { C, mono } from '../theme';
import { Badge, Btn, Card, Meter, Stepper, s as ui } from '../ui';

export function Listen({ s, onEnter, bottom }: { s: RadioState; onEnter: () => void; bottom: number }) {
  const onTune = useCallback(
    (e: TuneEvent) => {
      const { freq, drag, b } = e.nativeEvent;
      if (b) {
        const m = bandMode(freq) ?? s.mode;
        Radio.command({ action: 'vfo_b', f: snap(freq, SNAP[m]), mode: m });
        return;
      }
      const mode = drag ? s.mode : bandMode(freq) ?? s.mode;
      const f = snap(freq, drag ? FINE_SNAP[mode] : SNAP[mode]);
      if (f === s.freq) return;
      Radio.command(drag || mode === s.mode ? { action: 'tune', f, mode: s.mode, bw: s.bw } : { action: 'tune', f, mode });
    },
    [s.freq, s.mode, s.bw],
  );
  const label = s.rds?.ps || s.label || presetLabel(s.freq);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: bottom }} keyboardShouldPersistTaps="handled">
      <FreqCard s={s} label={label} onEnter={onEnter} />
      <View style={st.spectrumWrap}>
        <SpectrumView style={st.spectrum} onTune={onTune} />
        {!s.running && (
          <View style={st.idle} pointerEvents="none">
            <Text style={st.idleTitle}>📻</Text>
            <Text style={[ui.muted, { textAlign: 'center' }]}>
              {s.status === 'error' ? s.error : 'Plug the RTL-SDR into the USB-C port and tap Start'}
            </Text>
          </View>
        )}
      </View>
      <Text style={st.hint}>Tap to tune · drag to fine-tune · long-press to add channel B</Text>
      {s.vfoB && <ChannelB b={s.vfoB} />}
      <ModeCard mode={s.mode} bw={s.bw} hf={s.directSampling} />
      <Controls s={s} />
    </ScrollView>
  );
}

// ---------- frequency ----------

function FreqCard({ s, label, onEnter }: { s: RadioState; label: string; onEnter: () => void }) {
  const fav = s.favorites?.some((f) => Math.abs(f.f - s.freq) < 1000);
  const step = SNAP[s.mode];
  const big = s.mode === 'WFM' ? 1e6 : s.mode === 'AM' && s.freq < 30e6 ? 100e3 : 1e6;
  const tune = (f: number) => Radio.command({ action: 'tune', f: Math.max(100e3, f), mode: s.mode, bw: s.bw });
  const scanning = s.scan && s.scan.state !== 'hold';
  const sq = s.mode === 'WFM' && !s.scan ? 0 : s.squelch;
  const toggleFav = () => {
    if (fav) Radio.command({ action: 'fav_remove', f: s.freq });
    else Radio.command({ action: 'fav_add', f: s.freq, mode: s.mode, bw: s.bw, label: label || undefined });
  };
  const rec = s.recording;

  return (
    <Card>
      <View style={ui.row}>
        <Pressable onPress={onEnter} style={{ flex: 1 }} hitSlop={6}>
          <Text style={st.freq} numberOfLines={1} adjustsFontSizeToFit>
            {fmtMHz(s.freq)}
            <Text style={st.unit}> MHz</Text>
          </Text>
        </Pressable>
        <Pressable onPress={toggleFav} hitSlop={12}>
          <Text style={[st.star, fav && { color: C.amber }]}>{fav ? '★' : '☆'}</Text>
        </Pressable>
      </View>
      <View style={[ui.row, { gap: 6, marginTop: 2, flexWrap: 'wrap' }]}>
        <Badge text={s.mode} />
        {s.stereoActive && <Badge text="STEREO" color={C.accent} />}
        {s.directSampling && <Badge text="HF" color={C.violet} />}
        {s.rds?.pty ? <Badge text={s.rds.pty.toUpperCase()} color={C.muted} /> : null}
        <Text style={st.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {s.rds?.rt ? (
        <Text style={st.rt} numberOfLines={2}>
          {s.rds.rt}
        </Text>
      ) : null}
      <View style={{ marginTop: 12 }}>
        {scanning ? (
          <Text style={[ui.muted, { fontFamily: mono }]}>{s.scan!.state === 'sweep' ? 'surveying…' : 'scanning…'}</Text>
        ) : (
          <Meter db={s.snr} squelch={sq} open={s.open} />
        )}
      </View>
      <View style={[ui.row, { gap: 6, marginTop: 12 }]}>
        <Btn label={`−${fmtStep(big)}`} onPress={() => tune(snap(s.freq, step) - big)} style={st.step} small />
        <Btn label={`−${fmtStep(step)}`} onPress={() => tune(snap(s.freq, step) - step)} style={st.step} small />
        <Btn label={`+${fmtStep(step)}`} onPress={() => tune(snap(s.freq, step) + step)} style={st.step} small />
        <Btn label={`+${fmtStep(big)}`} onPress={() => tune(snap(s.freq, step) + big)} style={st.step} small />
      </View>
      <View style={[ui.row, { gap: 6, marginTop: 8 }]}>
        <Btn label="⌖ Strongest" small onPress={() => Radio.command({ action: 'strongest' })} style={{ flex: 1 }} disabled={!s.running} />
        <Btn
          label={rec ? `■ ${fmtDuration(rec.seconds)}` : '● Record'}
          small
          danger={!!rec}
          onPress={() => Radio.command({ action: 'record', on: !rec })}
          style={{ flex: 1 }}
          disabled={!s.running}
        />
      </View>
    </Card>
  );
}

const fmtStep = (hz: number) => (hz >= 1e6 ? `${hz / 1e6}M` : hz >= 1000 ? `${hz / 1000}k` : `${hz}`);

// ---------- channel B ----------

const ChannelB = memo(function ChannelB({ b }: { b: VfoB }) {
  return (
    <Card style={{ borderColor: '#3b3266' }}>
      <View style={[ui.row, { gap: 8 }]}>
        <Badge text="B" color={C.violet} />
        <Text style={st.bFreq}>{fmtMHz(b.freq)}</Text>
        <Text style={[ui.muted, { flex: 1 }]} numberOfLines={1}>
          {`${b.mode} · ${b.label || presetLabel(b.freq)}`}
        </Text>
        <Btn label="⇄" small onPress={() => Radio.command({ action: 'swap' })} />
        <Btn label="✕" small onPress={() => Radio.command({ action: 'vfo_b_off' })} />
      </View>
      {b.inView ? (
        <View style={{ marginTop: 10 }}>
          <Meter db={b.snr} squelch={b.mode === 'WFM' ? 0 : b.squelch} open={b.open} color={C.violet} />
        </View>
      ) : (
        <Text style={[st.warn, { marginTop: 8 }]}>Too far from A to play together (both must fit in 1.7 MHz)</Text>
      )}
      {b.mode !== 'WFM' && (
        <Stepper
          name="Squelch B"
          value={b.squelch > 0 ? `${b.squelch} dB` : 'Off'}
          onMinus={() => Radio.command({ action: 'vfo_b_squelch', db: Math.max(0, b.squelch - 1) })}
          onPlus={() => Radio.command({ action: 'vfo_b_squelch', db: Math.min(40, b.squelch + 1) })}
        />
      )}
    </Card>
  );
});

// ---------- mode / bandwidth ----------

const ModeCard = memo(function ModeCard({ mode, bw, hf }: { mode: Mode; bw: number; hf: boolean }) {
  const setBw = (v: number) => Radio.command({ action: 'bw', bw: Math.max(100, Math.min(220000, v)) });
  return (
    <Card>
      <View style={st.seg}>
        {MODES.map((m) => (
          <Pressable key={m} onPress={() => Radio.command({ action: 'mode', mode: m })} style={[st.segBtn, m === mode && st.segOn]}>
            <Text style={[st.segText, m === mode && { color: C.bg }]}>{m}</Text>
          </Pressable>
        ))}
      </View>
      <View style={[ui.row, { gap: 8, marginTop: 10 }]}>
        <Text style={ui.stepName}>Bandwidth</Text>
        <Btn label="−" small onPress={() => setBw(bw - BW_STEP[mode])} style={ui.stepBtn} />
        <Text style={ui.stepValue} onPress={() => setBw(DEFAULT_BW[mode])} suppressHighlighting>
          {fmtBw(bw)}
        </Text>
        <Btn label="+" small onPress={() => setBw(bw + BW_STEP[mode])} style={ui.stepBtn} />
      </View>
      {hf && <Text style={[ui.muted, { marginTop: 8, fontSize: 12 }]}>HF direct sampling: below 24 MHz the stick samples the antenna directly. Use a long wire antenna.</Text>}
    </Card>
  );
});

// ---------- gain / squelch / options ----------

function Controls({ s }: { s: RadioState }) {
  const gains = s.gains ?? [];
  const gi = s.gain == null ? -1 : gains.findIndex((g) => Math.abs(g - s.gain!) < 0.05);
  const setGain = (i: number) => Radio.command({ action: 'gain', db: i < 0 ? null : gains[Math.max(0, Math.min(i, gains.length - 1))] });
  const sqStep = (d: number) => Radio.command({ action: 'squelch', db: Math.max(0, Math.min(40, s.squelch + d)) });
  const voice = s.mode !== 'WFM';
  return (
    <Card>
      <Stepper
        name="Gain"
        value={s.gain == null ? 'Auto' : `${s.gain.toFixed(1)} dB`}
        onMinus={() => setGain(gi < 0 ? gains.length - 1 : gi - 1)}
        onPlus={() => setGain(gi < 0 ? gains.length - 1 : gi + 1)}
        extra={<Btn label="Auto" small onPress={() => setGain(-1)} active={s.gain == null} />}
      />
      <Stepper
        name="Squelch"
        value={!voice && !s.scan ? 'Off for FM' : s.squelch > 0 ? `${s.squelch} dB` : 'Off'}
        onMinus={() => sqStep(-1)}
        onPlus={() => sqStep(1)}
      />
      <Stepper
        name="PPM"
        value={`${s.ppm > 0 ? '+' : ''}${s.ppm}`}
        onMinus={() => Radio.command({ action: 'ppm', ppm: s.ppm - 1 })}
        onPlus={() => Radio.command({ action: 'ppm', ppm: s.ppm + 1 })}
      />
      <View style={[ui.row, { gap: 8, marginTop: 8 }]}>
        <Btn label="Stereo" small active={s.stereo} onPress={() => Radio.command({ action: 'stereo', on: !s.stereo })} style={{ flex: 1 }} />
        <Btn
          label="Noise reduction"
          small
          active={s.nr}
          onPress={() => Radio.command({ action: 'nr', on: !s.nr })}
          onLongPress={() => Alert.alert('Noise reduction', 'Learns the steady background hiss on voice channels (AM, NFM, SSB) and removes it.')}
          style={{ flex: 1.4 }}
        />
      </View>
    </Card>
  );
}

const st = StyleSheet.create({
  freq: { color: C.text, fontSize: 46, fontWeight: '300', fontFamily: mono, letterSpacing: -1.5 },
  unit: { fontSize: 18, color: C.muted, letterSpacing: 0 },
  star: { fontSize: 30, color: C.muted, paddingHorizontal: 6 },
  label: { color: C.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  rt: { color: C.accent, fontSize: 14, marginTop: 6, lineHeight: 19 },
  step: { flex: 1 },
  spectrumWrap: { marginHorizontal: 12, marginTop: 10, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  spectrum: { height: 300, backgroundColor: '#0a0d11' },
  idle: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  idleTitle: { fontSize: 34 },
  hint: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 6 },
  bFreq: { color: C.text, fontFamily: mono, fontSize: 18 },
  warn: { color: C.amber, fontSize: 12 },
  seg: { flexDirection: 'row', backgroundColor: C.panel2, borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segOn: { backgroundColor: C.accent },
  segText: { color: C.text, fontWeight: '700', fontSize: 13 },
});
