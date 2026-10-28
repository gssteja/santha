import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radio, type AppMode, type RadioState } from './modules/rtl-radio';
import { bandMode, fmtMHz } from './src/format';
import { GROUPS } from './src/presets';
import { Decode, type DecodeMode } from './src/screens/Decode';
import { Listen } from './src/screens/Listen';
import { Planes } from './src/screens/Planes';
import { Presets } from './src/screens/Presets';
import { Recordings } from './src/screens/Recordings';
import { Survey } from './src/screens/Survey';
import { C, mono } from './src/theme';
import { Btn, s as ui } from './src/ui';
import { useRadio } from './src/useRadio';

type Tab = 'listen' | 'presets' | 'survey' | 'planes' | 'decode' | 'recordings';

const TABS: { id: Tab; icon: string; name: string }[] = [
  { id: 'listen', icon: '📻', name: 'Listen' },
  { id: 'presets', icon: '☰', name: 'Presets' },
  { id: 'survey', icon: '📊', name: 'Survey' },
  { id: 'planes', icon: '✈', name: 'Planes' },
  { id: 'decode', icon: '📡', name: 'Decode' },
  { id: 'recordings', icon: '●', name: 'Recordings' },
];

/** The Planes and Decode tabs take over the dongle (as on the Mac); every other tab is the radio. */
const modeFor = (t: Tab, d: DecodeMode): AppMode => (t === 'planes' ? 'planes' : t === 'decode' ? d : 'radio');

const DECODE_MODES: AppMode[] = ['sensors', 'weather', 'aprs', 'acars'];

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <RadioScreen />
    </SafeAreaProvider>
  );
}

function RadioScreen() {
  const s = useRadio();
  const insets = useSafeAreaInsets();
  // reopening the app while the service tracks planes or decodes something lands back on that tab
  const [tab, setTabState] = useState<Tab>(() => (s.appMode === 'planes' ? 'planes' : DECODE_MODES.includes(s.appMode) ? 'decode' : 'listen'));
  const [decodeMode, setDecodeState] = useState<DecodeMode>(() => (DECODE_MODES.includes(s.appMode) ? (s.appMode as DecodeMode) : 'weather'));
  const setTab = useCallback(
    (t: Tab) => {
      setTabState(t);
      Radio.command({ action: 'app_mode', mode: modeFor(t, decodeMode) });
    },
    [decodeMode],
  );
  const setDecodeMode = useCallback((d: DecodeMode) => {
    setDecodeState(d);
    Radio.command({ action: 'app_mode', mode: d });
  }, []);
  const [groupId, setGroupId] = useState(GROUPS[0]?.id ?? 'fav');
  const [entry, setEntry] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      await Radio.start();
    } catch (e) {
      Alert.alert('Radio', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const bottom = 24;
  return (
    <View style={[st.root, { paddingTop: insets.top }]}>
      <Header s={s} busy={busy} onStart={start} />
      <View style={{ flex: 1 }}>
        {/* Listen stays mounted (hidden) so the waterfall keeps its history across tab switches */}
        <View style={{ flex: 1, display: tab === 'listen' ? 'flex' : 'none' }}>
          <Listen s={s} onEnter={() => setEntry(true)} bottom={bottom} />
        </View>
        {tab === 'presets' && <Presets s={s} groupId={groupId} setGroupId={setGroupId} bottom={bottom} />}
        {tab === 'survey' && <Survey s={s} bottom={bottom} />}
        {tab === 'planes' && <Planes s={s} bottom={bottom} />}
        {tab === 'decode' && <Decode s={s} mode={decodeMode} setMode={setDecodeMode} bottom={bottom} />}
        {tab === 'recordings' && <Recordings s={s} bottom={bottom} />}
      </View>
      {s.appMode === 'radio' && <ScanBar s={s} />}
      <View style={[st.tabs, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {TABS.map((t) => (
          <Pressable key={t.id} style={st.tab} onPress={() => setTab(t.id)}>
            <Text style={[st.tabIcon, t.id === 'recordings' && s.recording && { color: C.danger }]}>{t.icon}</Text>
            <Text style={[st.tabText, tab === t.id && { color: C.accent }]}>{t.name}</Text>
            {tab === t.id && <View style={st.tabBar} />}
          </Pressable>
        ))}
      </View>
      <FreqEntry visible={entry} freq={s.freq} onClose={() => setEntry(false)} />
    </View>
  );
}

function Header({ s, busy, onStart }: { s: RadioState; busy: boolean; onStart: () => void }) {
  const dot = s.status === 'radio' ? C.ok : s.status === 'error' ? C.danger : s.running ? C.amber : C.muted;
  const text = s.status === 'radio' ? s.device : s.status === 'error' ? s.error : s.running ? 'Starting…' : 'Off';
  const needsStart = !s.running || s.needsPermission;
  return (
    <View style={st.header}>
      <Text style={st.title}>Tarang</Text>
      <View style={[st.dot, { backgroundColor: dot }]} />
      <Text style={[ui.muted, { flex: 1, fontSize: 12 }]} numberOfLines={2}>
        {text}
      </Text>
      {needsStart ? <Btn label={busy ? '…' : 'Start'} primary onPress={onStart} /> : <Btn label="Stop" danger onPress={() => Radio.stop()} />}
    </View>
  );
}

function ScanBar({ s }: { s: RadioState }) {
  const sc = s.scan;
  if (!sc || sc.state === 'sweep') return null;
  const hold = sc.state === 'hold';
  const text =
    sc.state === 'survey'
      ? `Finding stations in ${sc.name}… ${sc.progress}`
      : hold
        ? `${fmtMHz(s.freq)} ${s.label || ''} · ${s.snr.toFixed(0)} dB`
        : `Scanning ${sc.name}… ${sc.progress}`;
  return (
    <View style={st.scanBar}>
      <View style={{ flex: 1 }}>
        <Text style={ui.text} numberOfLines={1}>
          {text}
        </Text>
        <Text style={[ui.muted, { fontSize: 11 }]} numberOfLines={1}>
          {hold ? `active in ${sc.name}` : 'stops on anything above the squelch'}
          {sc.ignored ? ` · ${sc.ignored} ignored` : ''}
        </Text>
      </View>
      {hold && <Btn label="Skip" small onPress={() => Radio.command({ action: 'scan_skip' })} />}
      {hold && <Btn label="Ignore" small onPress={() => Radio.command({ action: 'scan_ignore' })} />}
      {hold && <Btn label="Stay" small onPress={() => Radio.command({ action: 'scan_stay' })} />}
      <Btn label="■" small danger onPress={() => Radio.command({ action: 'scan_stop' })} />
    </View>
  );
}

function FreqEntry({ visible, freq, onClose }: { visible: boolean; freq: number; onClose: () => void }) {
  const [text, setText] = useState('');
  const submit = () => {
    const mhz = parseFloat(text.replace(',', '.'));
    if (mhz >= 0.1 && mhz <= 1766) {
      const f = Math.round(mhz * 1e6);
      const mode = bandMode(f);
      Radio.command(mode ? { action: 'tune', f, mode } : { action: 'tune', f });
      onClose();
    } else {
      Alert.alert('Frequency', 'Enter a frequency between 0.1 and 1766 MHz');
    }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={() => setText(fmtMHz(freq))}>
      <Pressable style={st.modalBg} onPress={onClose}>
        <Pressable style={st.modal} onPress={() => {}}>
          <Text style={ui.h2}>Tune to (MHz)</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            autoFocus
            selectTextOnFocus
            onSubmitEditing={submit}
            style={st.input}
          />
          <Text style={[ui.muted, { fontSize: 12, marginBottom: 14 }]}>Below 24 MHz uses HF direct sampling (long wire antenna).</Text>
          <View style={[ui.row, { gap: 8, justifyContent: 'flex-end' }]}>
            <Btn label="Cancel" onPress={onClose} />
            <Btn label="Tune" primary onPress={submit} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  title: { color: C.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.panel, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
  tabIcon: { fontSize: 17, color: C.text },
  tabText: { color: C.muted, fontSize: 11, fontWeight: '600' },
  tabBar: { position: 'absolute', top: -6, width: 28, height: 2, borderRadius: 1, backgroundColor: C.accent },
  scanBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1d1a10',
    borderTopWidth: 1,
    borderTopColor: C.amber,
  },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: C.panel, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: C.line },
  input: { color: C.text, fontSize: 34, fontFamily: mono, borderBottomWidth: 1, borderBottomColor: C.accent, marginBottom: 8, paddingVertical: 6 },
});
