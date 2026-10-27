import { memo, useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Radio, type Hit, type Mode, type RadioState } from '../../modules/rtl-radio';
import { fmtMHz } from '../format';
import { GROUPS } from '../presets';
import { C, mono } from '../theme';
import { Btn, Card, Chip, SectionTitle, s as ui } from '../ui';

type Chan = { f: number; label: string; mode: Mode; bw: number; fav: boolean };

export function Presets({ s, groupId, setGroupId, bottom }: { s: RadioState; groupId: string; setGroupId: (id: string) => void; bottom: number }) {
  const g = GROUPS.find((x) => x.id === groupId);
  const isFav = groupId === 'fav';
  const scanningThis = s.scan?.group === groupId;
  const survey = g ? s.survey?.[g.id] : undefined;

  const chans: Chan[] = useMemo(() => {
    if (isFav) return (s.favorites ?? []).map((f) => ({ ...f, fav: true }));
    if (!g) return [];
    if (g.channels) return g.channels.map((c) => ({ ...c, mode: g.mode, bw: g.bw, fav: false }));
    if (survey)
      return survey.stations.map((st) => ({
        f: st.f,
        label: s.rdsNames?.[String(st.f)] || `${st.snr.toFixed(0)} dB`,
        mode: g.mode,
        bw: g.bw,
        fav: false,
      }));
    return [];
  }, [isFav, g, survey, s.favorites, s.rdsNames]);

  const scan = () => {
    if (isFav) {
      const fav = s.favorites ?? [];
      if (fav.length) Radio.command({ action: 'scan', group: 'fav', name: 'Favorites', mode: s.mode, channels: fav });
    } else if (g) {
      Radio.command({ action: g.survey ? 'survey' : 'scan', group: g.id, name: g.name, mode: g.mode, channels: g.scanChannels, threshold: g.squelch });
    }
  };

  let empty = '';
  if (!chans.length) {
    if (isFav) empty = 'No favorites yet. Tap ☆ next to the frequency on the Listen tab to save one.';
    else if (g?.survey) empty = 'No station list yet. Tap “Find stations” to sweep the band (takes a few seconds).';
    else empty = 'This is a whole band. Tap Scan and the radio stops on anything active.';
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: bottom }}>
      <Card>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Chip label="★ Favorites" on={isFav} onPress={() => setGroupId('fav')} color={C.amber} />
          {GROUPS.map((x) => (
            <Chip key={x.id} label={x.name} on={x.id === groupId} onPress={() => setGroupId(x.id)} />
          ))}
        </ScrollView>
        {g && !isFav ? <Text style={[ui.muted, { marginTop: 10, lineHeight: 19 }]}>{g.desc}</Text> : null}
        <View style={[ui.row, { gap: 8, marginTop: 12 }]}>
          {scanningThis ? (
            <Btn label="■ Stop scan" danger onPress={() => Radio.command({ action: 'scan_stop' })} />
          ) : (
            <Btn
              label={g?.survey && !isFav ? (survey ? '↻ Find stations again' : 'Find stations') : `▶ Scan ${isFav ? 'favorites' : g?.name ?? ''}`}
              primary
              onPress={scan}
              disabled={!s.running}
            />
          )}
          {g?.range && !g.survey && !isFav ? <Text style={ui.muted}>{`${g.range[0]}–${g.range[1]} MHz`}</Text> : null}
        </View>
        {!s.running && <Text style={[st.warn, { marginTop: 8 }]}>Start the radio to scan.</Text>}
        {empty ? <Text style={[ui.muted, { marginTop: 12 }]}>{empty}</Text> : null}
        <ChannelGrid chans={chans} freq={s.freq} />
      </Card>
      <Hits hits={s.hits} />
    </ScrollView>
  );
}

const ChannelGrid = memo(function ChannelGrid({ chans, freq }: { chans: Chan[]; freq: number }) {
  if (!chans.length) return null;
  return (
    <View style={st.grid}>
      {chans.map((c) => {
        const on = Math.abs(c.f - freq) < 1000;
        return (
          <Pressable
            key={c.f}
            style={({ pressed }) => [st.chan, on && st.chanOn, pressed && { opacity: 0.6 }]}
            onPress={() => Radio.command({ action: 'tune', f: c.f, mode: c.mode, bw: c.bw, label: c.label })}
            onLongPress={() => {
              if (c.fav) {
                Alert.alert('Remove favorite?', `${fmtMHz(c.f)} MHz ${c.label}`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => Radio.command({ action: 'fav_remove', f: c.f }) },
                ]);
              } else {
                Radio.command({ action: 'vfo_b', f: c.f, mode: c.mode, bw: c.bw, label: c.label });
              }
            }}>
            <Text style={[st.chanF, on && { color: C.bg }]}>{fmtMHz(c.f)}</Text>
            <Text style={[st.chanL, on && { color: C.bg }]} numberOfLines={1}>
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const Hits = memo(function Hits({ hits }: { hits: Hit[] | undefined }) {
  return (
    <Card>
      <SectionTitle>Recent activity</SectionTitle>
      {!hits?.length ? (
        <Text style={ui.muted}>Start a scan and anything it hears shows up here.</Text>
      ) : (
        hits.map((h) => (
          <Pressable
            key={`${h.t}-${h.f}`}
            style={st.hit}
            onPress={() => Radio.command({ action: 'tune', f: h.f, mode: h.mode, bw: h.bw, label: h.label })}>
            <Text style={st.hitT}>{new Date(h.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text>
            <Text style={[ui.text, { flex: 1 }]} numberOfLines={1}>
              <Text style={{ fontFamily: mono }}>{fmtMHz(h.f)}</Text> {h.label} <Text style={ui.muted}>{h.group}</Text>
            </Text>
            <Text style={ui.muted}>{h.snr.toFixed(0)} dB</Text>
          </Pressable>
        ))
      )}
    </Card>
  );
});

const st = StyleSheet.create({
  warn: { color: C.amber, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chan: { width: '32%', backgroundColor: C.panel2, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 9, borderWidth: 1, borderColor: C.line },
  chanOn: { backgroundColor: C.amber, borderColor: C.amber },
  chanF: { color: C.text, fontFamily: mono, fontSize: 15 },
  chanL: { color: C.muted, fontSize: 11, marginTop: 2 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line },
  hitT: { color: C.muted, width: 70, fontFamily: mono, fontSize: 12 },
});
