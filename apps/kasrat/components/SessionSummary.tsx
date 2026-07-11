import { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, FONT, HEAT, RADIUS, SHADOW } from '@/constants/theme';
import { ForgedNumber } from '@/components/ui/ForgedNumber';
import { Glow } from '@/components/ui/Glow';
import { haptics } from '@/components/ui/haptics';
import type { PRKind } from '@/engine/progression';

export type SessionPR = { name: string; kind: PRKind; orm: number; volume: number };

export type Session = {
  name: string;
  durationSec: number;
  sets: number;
  volume: number;
  prs: SessionPR[];
};

// Same kind palette as the dashboard PR feed: heavier top single (e1RM), more total
// work (volume), or both.
const KIND_META: Record<PRKind, { tag: string; color: string }> = {
  strength: { tag: 'E1RM', color: HEAT.white },
  volume: { tag: 'VOLUME', color: HEAT.hot },
  both: { tag: 'E1RM + VOL', color: HEAT.white },
};

function cleanName(name: string) {
  return name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || name;
}

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SessionSummary({
  session,
  onDone,
}: {
  session: Session | null;
  onDone: () => void;
}) {
  const prCount = session?.prs.length ?? 0;

  // Land the finish with a beat — a PR salute when records fell, a plain thud otherwise.
  useEffect(() => {
    if (!session) return;
    if (prCount > 0) haptics.pr();
    else haptics.done();
  }, [session, prCount]);

  if (!session) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Glow color={prCount > 0 ? HEAT.hot : HEAT.warm} size={260} intensity={0.5} style={s.glow} />

          <Text style={s.kicker}>{session.name.toUpperCase()}</Text>
          <Text style={s.title}>{prCount > 0 ? 'FORGED.' : 'DONE.'}</Text>

          {/* Three headline stats */}
          <View style={s.stats}>
            <View style={s.stat}>
              <ForgedNumber value={fmtTime(session.durationSec)} size={22} color={C.text} textStyle={s.statNum} />
              <Text style={s.statLabel}>TIME</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.stat}>
              <ForgedNumber value={session.sets} size={22} color={C.text} textStyle={s.statNum} />
              <Text style={s.statLabel}>SETS</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.stat}>
              <ForgedNumber
                value={session.volume.toLocaleString()}
                size={22}
                color={HEAT.white}
                glow
                glowColor={HEAT.hot}
                glowIntensity={0.5}
                textStyle={s.statNum}
              />
              <Text style={s.statLabel}>LB MOVED</Text>
            </View>
          </View>

          {/* Records */}
          {prCount > 0 ? (
            <>
              <Text style={s.sectionLabel}>
                {prCount} {prCount === 1 ? 'RECORD' : 'RECORDS'} SET
              </Text>
              <ScrollView style={s.prScroll} contentContainerStyle={s.prList} showsVerticalScrollIndicator={false}>
                {session.prs.map((pr, i) => {
                  const meta = KIND_META[pr.kind];
                  const showVol = pr.kind === 'volume';
                  return (
                    <View key={`${pr.name}-${i}`} style={[s.prRow, i > 0 && s.prRowBorder]}>
                      <View style={s.prInfo}>
                        <Text style={s.prName} numberOfLines={1}>{cleanName(pr.name)}</Text>
                        <Text style={[s.prTag, { color: meta.color, borderColor: meta.color + '55' }]}>
                          {meta.tag}
                        </Text>
                      </View>
                      <View style={s.prVal}>
                        <ForgedNumber
                          value={showVol ? pr.volume.toLocaleString() : Math.round(pr.orm)}
                          size={22}
                          color={meta.color}
                        />
                        <Text style={s.prUnit}>{showVol ? 'lb vol' : 'e1RM'}</Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </>
          ) : (
            <Text style={s.noPr}>No new records this time — but the work still counts. Keep the streak hot.</Text>
          )}

          <TouchableOpacity style={s.btn} onPress={onDone} accessibilityLabel="Close summary">
            <Text style={s.btnText}>DONE</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: RADIUS.lg,
    paddingVertical: 26,
    paddingHorizontal: 22,
    overflow: 'hidden',
    ...SHADOW.card,
  },
  glow: { top: -60, left: -20, right: undefined, bottom: undefined },
  kicker: { color: C.text3, fontSize: F.xs, fontFamily: FONT.bold, letterSpacing: 1.5 },
  title: { color: C.text, fontSize: F.xxxl, fontFamily: FONT.black, letterSpacing: -0.5, marginTop: 2 },

  stats: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 4 },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { lineHeight: 24 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: C.border },
  statLabel: { color: C.text3, fontSize: F.xs - 1, fontFamily: FONT.bold, letterSpacing: 1.2, marginTop: 3 },

  sectionLabel: {
    color: C.text3,
    fontSize: F.xs,
    fontFamily: FONT.bold,
    letterSpacing: 2,
    marginTop: 22,
    marginBottom: 6,
  },
  prScroll: { maxHeight: 240 },
  prList: { gap: 0 },
  prRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11 },
  prRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  prInfo: { flex: 1, marginRight: 12, gap: 4 },
  prName: { color: C.text, fontSize: F.sm, fontFamily: FONT.bold },
  prTag: {
    alignSelf: 'flex-start',
    fontSize: F.xs - 2,
    fontFamily: FONT.bold,
    letterSpacing: 0.5,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  prVal: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  prUnit: { color: C.text3, fontSize: F.xs, fontFamily: FONT.medium },

  noPr: {
    color: C.text2,
    fontSize: F.sm,
    fontFamily: FONT.medium,
    lineHeight: 20,
    marginTop: 20,
    marginBottom: 4,
  },

  btn: {
    backgroundColor: C.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 22,
    ...SHADOW.ember,
  },
  btnText: { color: '#1a1206', fontSize: F.lg, fontFamily: FONT.black, letterSpacing: 0.5 },
});
