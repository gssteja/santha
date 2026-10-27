import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Radio, type RadioState } from '../../modules/rtl-radio';
import { fmtDuration } from '../format';
import { C, mono } from '../theme';
import { Btn, Card, SectionTitle, s as ui } from '../ui';

export function Recordings({ s, bottom }: { s: RadioState; bottom: number }) {
  const recs = s.recordings ?? [];
  const rec = s.recording;
  const del = (id: string, name: string) =>
    Alert.alert('Delete recording?', name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => Radio.deleteRecording(id) },
    ]);
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: bottom }}>
      <Card>
        <SectionTitle>Recording</SectionTitle>
        <Text style={[ui.muted, { lineHeight: 19 }]}>
          Saves what you hear (both channels) as WAV in Recordings/Tarang. Silent gaps between transmissions are skipped, so
          an hour of scanning airband becomes just the talking.
        </Text>
        <View style={[ui.row, { gap: 10, marginTop: 12 }]}>
          <Btn
            label={rec ? '■ Stop recording' : '● Record'}
            danger={!!rec}
            primary={!rec}
            disabled={!s.running}
            onPress={() => Radio.command({ action: 'record', on: !rec })}
          />
          {rec && <Text style={[ui.text, { fontFamily: mono }]}>{fmtDuration(rec.seconds)}</Text>}
        </View>
      </Card>
      <Card>
        <SectionTitle>Saved</SectionTitle>
        {recs.length === 0 && <Text style={ui.muted}>No recordings yet.</Text>}
        {recs.map((r) => (
          <View key={r.id} style={st.row}>
            <Pressable style={{ flex: 1 }} onPress={() => Radio.openRecording(r.id)}>
              <Text style={ui.text} numberOfLines={1}>
                {pretty(r.name)}
              </Text>
              <Text style={[ui.muted, { fontSize: 12 }]}>{fmtDuration(r.seconds)}</Text>
            </Pressable>
            <Btn label="▶" small onPress={() => Radio.openRecording(r.id)} />
            <Btn label="🗑" small onPress={() => del(r.id, r.name)} />
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

// 20261026-213012_121.1500MHz_Arrival-ATIS.wav -> "Oct 26 21:30 · 121.150 MHz · Arrival ATIS"
function pretty(name: string): string {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\d{2}_([\d.]+)MHz(?:_(.+))?\.wav$/);
  if (!m) return name;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = `${months[+m[2] - 1]} ${+m[3]} ${m[4]}:${m[5]}`;
  const f = `${parseFloat(m[6]).toFixed(3)} MHz`;
  return [when, f, m[7]?.replace(/-/g, ' ')].filter(Boolean).join(' · ');
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line },
});
