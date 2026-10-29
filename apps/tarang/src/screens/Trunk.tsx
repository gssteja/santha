import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Radio, type P25, type P25DirEntry, type P25LogEntry, type P25Talkgroup, type RadioState } from '../../modules/rtl-radio';
import { fmtDuration, fmtMHz } from '../format';
import { C, mono } from '../theme';
import { Badge, Btn, Card, Chip, SectionTitle, s as ui } from '../ui';

type View_ = 'active' | 'calls' | 'talkgroups' | 'setup';

const VIEWS: { id: View_; name: string }[] = [
  { id: 'active', name: 'Active' },
  { id: 'calls', name: 'Calls' },
  { id: 'talkgroups', name: 'Talkgroups' },
  { id: 'setup', name: 'Setup' },
];

function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
}

function useTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

const tgLabel = (t: { tg?: number; id?: number; name: string }) => t.name || `TG ${t.tg ?? t.id}`;
const unit = (src: number) => (src > 0 ? `unit ${src}` : 'unit ?');
const chan = (f: number, tdma: boolean, slot: number) => (f ? `${fmtMHz(f)} MHz${tdma ? ` slot ${slot + 1}` : ''}` : '');

/** TSBKs per second, from the receiver's running count. */
function useRate(count: number | undefined): number {
  const last = useRef<{ n: number; t: number } | null>(null);
  const [rate, setRate] = useState(0);
  useEffect(() => {
    if (count === undefined) return;
    const now = Date.now();
    const l = last.current;
    if (!l || count < l.n) last.current = { n: count, t: now };
    else if (now - l.t >= 2000) {
      setRate(((count - l.n) * 1000) / (now - l.t));
      last.current = { n: count, t: now };
    }
  }, [count]);
  return rate;
}

export function Trunk({ s, bottom }: { s: RadioState; bottom: number }) {
  useTick();
  const p = s.p25;
  const [view, setView] = useState<View_>('active');
  const header = (
    <>
      <Status s={s} p={p} />
      {p?.call && <NowTalking p={p} />}
      <View style={st.views}>
        {VIEWS.map((v) => (
          <Chip key={v.id} label={v.name} on={view === v.id} onPress={() => setView(v.id)} />
        ))}
      </View>
    </>
  );
  if (view === 'talkgroups') return <Directory s={s} header={header} bottom={bottom} />;
  if (view === 'setup') return <Setup s={s} header={header} bottom={bottom} />;
  if (view === 'calls')
    return (
      <FlatList
        data={p?.log ?? []}
        keyExtractor={(e, i) => `${e.t}-${i}`}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: bottom }}
        ListEmptyComponent={<Text style={st.empty}>No calls followed yet.</Text>}
        renderItem={({ item }) => <CallRow e={item} />}
      />
    );
  return (
    <FlatList
      data={p?.tgs ?? []}
      keyExtractor={(t) => String(t.id)}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: bottom }}
      ListEmptyComponent={<Text style={st.empty}>No talkgroup activity yet.</Text>}
      renderItem={({ item }) => <TgRow t={item} />}
    />
  );
}

function Status({ s, p }: { s: RadioState; p: P25 | null }) {
  const rate = useRate(p?.rx?.tsbks);
  const listen = p?.settings.listen ?? true;
  let line: string;
  if (!s.running) line = 'Tap Start to begin.';
  else if (s.appMode !== 'p25' || s.status === 'starting' || !p || p.mode === 'off') line = 'Starting…';
  else if (s.status === 'error') line = s.error;
  else if (p.mode === 'hunt') line = `Looking for the control channel: ${p.ccs.map(fmtMHz).join(', ')} MHz`;
  else line = `Control channel ${fmtMHz(p.cc)} MHz · ${rate.toFixed(1)} messages/s`;
  const site = p && p.rfss >= 0 ? ` · site ${p.rfss}-${p.site}` : '';
  const ident = p && p.nac >= 0 ? `NAC ${p.nac.toString(16).toUpperCase()}${p.sysid >= 0 ? ` · system ${p.sysid.toString(16).toUpperCase()}` : ''}${site}` : '';
  return (
    <Card>
      <View style={[ui.row, { gap: 8 }]}>
        <View style={{ flex: 1 }}>
          <SectionTitle>{p?.system || 'P25 trunked radio'}</SectionTitle>
        </View>
        <Btn
          label={listen ? '🔊 Following calls' : '🔇 Watching only'}
          small
          active={listen}
          onPress={() => Radio.command({ action: 'p25_listen', on: !listen })}
        />
      </View>
      <Text style={[p?.mode === 'control' || p?.mode === 'voice' ? ui.text : st.warn, { fontSize: 13 }]}>{line}</Text>
      {!!ident && <Text style={[ui.muted, { fontSize: 12, marginTop: 2 }]}>{ident}</Text>}
      <View style={[ui.row, { gap: 6, marginTop: 10, flexWrap: 'wrap' }]}>
        <Chip
          label="Favorites only"
          on={!!p?.settings.favoritesOnly}
          onPress={() => Radio.command({ action: 'p25_favorites_only', on: !p?.settings.favoritesOnly })}
        />
        {p && p.settings.hold >= 0 && (
          <Chip label={`Holding ${p.settings.hold} ✕`} on color={C.violet} onPress={() => Radio.command({ action: 'p25_hold', tg: -1 })} />
        )}
      </View>
    </Card>
  );
}

function NowTalking({ p }: { p: P25 }) {
  const c = p.call!;
  const held = p.settings.hold === c.tg;
  const color = c.emergency ? C.danger : c.enc === 1 ? C.amber : c.talking ? C.ok : C.accent;
  return (
    <Card style={{ borderColor: color }}>
      <View style={[ui.row, { gap: 8 }]}>
        <View style={[st.light, { backgroundColor: c.talking ? C.ok : C.line }]} />
        <Text style={st.now} numberOfLines={1}>
          {tgLabel(c)}
        </Text>
        {c.emergency && <Badge text="EMERGENCY" color={C.danger} />}
        {c.enc === 1 && <Badge text="ENCRYPTED" color={C.amber} />}
        {c.enc === -1 && <Badge text="CHECKING" color={C.muted} />}
      </View>
      <Text style={st.meta}>
        {[`TG ${c.tg}`, c.cat, unit(c.src), chan(c.f, c.tdma, c.slot), fmtDuration(c.dur / 1000)].filter(Boolean).join(' · ')}
      </Text>
      <View style={[ui.row, { gap: 8, marginTop: 10 }]}>
        <Btn label="Skip" small onPress={() => Radio.command({ action: 'p25_skip' })} />
        <Btn label={held ? 'Release' : 'Hold'} small active={held} onPress={() => Radio.command({ action: 'p25_hold', tg: held ? -1 : c.tg })} />
        <Btn label={c.fav ? '★ Favorite' : '☆ Favorite'} small active={c.fav} onPress={() => Radio.command({ action: 'p25_tg', id: c.tg, fav: !c.fav })} />
        <Btn label="Lock out" small danger onPress={() => Radio.command({ action: 'p25_tg', id: c.tg, lockout: true })} />
      </View>
    </Card>
  );
}

function Flags({ t }: { t: { fav: boolean; lockout: boolean; id?: number; tg?: number } }) {
  const id = (t.id ?? t.tg)!;
  return (
    <View style={[ui.row, { gap: 2 }]}>
      <Pressable hitSlop={6} onPress={() => Radio.command({ action: 'p25_tg', id, fav: !t.fav })}>
        <Text style={[st.flag, t.fav && { color: C.amber }]}>{t.fav ? '★' : '☆'}</Text>
      </Pressable>
      <Pressable hitSlop={6} onPress={() => Radio.command({ action: 'p25_tg', id, lockout: !t.lockout })}>
        <Text style={[st.flag, t.lockout && { color: C.danger }]}>⛔</Text>
      </Pressable>
    </View>
  );
}

function TgRow({ t }: { t: P25Talkgroup }) {
  return (
    <View style={[st.row, t.lockout && { opacity: 0.45 }]}>
      <View style={{ flex: 1 }}>
        <View style={[ui.row, { gap: 6 }]}>
          <Text style={st.name} numberOfLines={1}>
            {tgLabel(t)}
          </Text>
          {t.enc === 1 && <Text style={st.lock}>🔒</Text>}
          {t.emergency && <Badge text="EMRG" color={C.danger} />}
          <Text style={[ui.muted, { fontSize: 12, marginLeft: 'auto' }]}>{ago(t.t)}</Text>
        </View>
        <Text style={st.meta}>
          {[`TG ${t.id}`, t.cat, `${t.calls} call${t.calls === 1 ? '' : 's'}`, t.src > 0 ? unit(t.src) : '', chan(t.f, t.tdma, t.slot)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Flags t={t} />
    </View>
  );
}

const END: Record<string, string> = {
  ended: 'ended',
  quiet: 'went quiet',
  signal: 'signal lost',
  'no voice': 'no voice heard',
  encrypted: 'encrypted, not played',
  skipped: 'skipped',
  preempted: 'interrupted by a favorite',
  reassigned: 'channel reassigned',
};

function CallRow({ e }: { e: P25LogEntry }) {
  return (
    <View style={st.row}>
      <View style={{ flex: 1 }}>
        <View style={[ui.row, { gap: 6 }]}>
          <Text style={st.name} numberOfLines={1}>
            {tgLabel(e)}
          </Text>
          {e.enc === 1 && <Text style={st.lock}>🔒</Text>}
          <Text style={[ui.muted, { fontSize: 12, marginLeft: 'auto' }]}>{ago(e.t)}</Text>
        </View>
        <Text style={st.meta}>
          {[unit(e.src), fmtDuration(e.dur / 1000), chan(e.f, e.tdma, e.slot), END[e.end] ?? e.end].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

// ---------- talkgroup directory ----------

function Directory({ s, header, bottom }: { s: RadioState; header: ReactElement; bottom: number }) {
  const dir = s.p25Dir ?? [];
  const cats = useMemo(() => Array.from(new Set(dir.map((d) => d.cat).filter(Boolean))), [dir]);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return dir.filter(
      (d) => (!cat || d.cat === cat) && (!k || d.name.toLowerCase().includes(k) || d.desc.toLowerCase().includes(k) || String(d.id) === k),
    );
  }, [dir, cat, q]);
  return (
    <FlatList
      data={list}
      keyExtractor={(d) => String(d.id)}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          {header}
          <View style={st.filters}>
            <TextInput value={q} onChangeText={setQ} placeholder="Search name or ID" placeholderTextColor={C.muted} style={st.search} />
            <View style={[ui.row, { gap: 6, flexWrap: 'wrap' }]}>
              <Chip label="All" on={!cat} onPress={() => setCat(null)} />
              {cats.map((c) => (
                <Chip key={c} label={c} on={cat === c} onPress={() => setCat(cat === c ? null : c)} />
              ))}
            </View>
          </View>
        </>
      }
      contentContainerStyle={{ paddingBottom: bottom }}
      ListEmptyComponent={<Text style={st.empty}>No talkgroups match.</Text>}
      renderItem={({ item }) => <DirRow d={item} editing={editing === item.id} onEdit={() => setEditing(editing === item.id ? null : item.id)} />}
    />
  );
}

function DirRow({ d, editing, onEdit }: { d: P25DirEntry; editing: boolean; onEdit: () => void }) {
  const [name, setName] = useState(d.name);
  useEffect(() => setName(d.name), [d.name]);
  return (
    <View style={[st.row, d.lockout && { opacity: 0.45 }]}>
      <Pressable style={{ flex: 1 }} onPress={onEdit}>
        <View style={[ui.row, { gap: 6 }]}>
          <Text style={st.name} numberOfLines={1}>
            {d.name || `TG ${d.id}`}
          </Text>
          {d.enc && <Text style={st.lock}>🔒</Text>}
        </View>
        <Text style={st.meta} numberOfLines={1}>
          {[`TG ${d.id}`, d.cat, d.desc].filter(Boolean).join(' · ')}
        </Text>
        {editing && (
          <View style={[ui.row, { gap: 8, marginTop: 8 }]}>
            <TextInput value={name} onChangeText={setName} style={[st.search, { flex: 1, marginBottom: 0 }]} autoFocus />
            <Btn
              label="Save"
              small
              primary
              onPress={() => {
                Radio.command({ action: 'p25_tg', id: d.id, name });
                onEdit();
              }}
            />
            <Btn label="Hold" small onPress={() => Radio.command({ action: 'p25_hold', tg: d.id })} />
          </View>
        )}
      </Pressable>
      <Flags t={d} />
    </View>
  );
}

// ---------- setup ----------

function Setup({ s, header, bottom }: { s: RadioState; header: ReactElement; bottom: number }) {
  const p = s.p25;
  const [ccText, setCcText] = useState('');
  const [csv, setCsv] = useState('');
  useEffect(() => {
    if (p) setCcText(p.settings.ccs.map(fmtMHz).join(', '));
  }, [p?.settings.ccs.join(',')]);
  const rx = p?.rx;
  return (
    <FlatList
      data={[]}
      renderItem={null}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: bottom }}
      ListHeaderComponent={
        <>
          {header}
          <Card>
            <SectionTitle>Site</SectionTitle>
            <View style={[ui.row, { gap: 6, flexWrap: 'wrap' }]}>
              {(p?.sites ?? []).map((x) => (
                <Chip
                  key={x.index}
                  label={x.name}
                  on={!p?.settings.custom && p?.settings.site === x.index}
                  onPress={() => Radio.command({ action: 'p25_site', index: x.index })}
                />
              ))}
            </View>
            <Text style={[ui.muted, { fontSize: 12, marginTop: 12, marginBottom: 4 }]}>Control channels (MHz), tried in turn</Text>
            <View style={[ui.row, { gap: 8 }]}>
              <TextInput value={ccText} onChangeText={setCcText} keyboardType="numbers-and-punctuation" style={[st.search, { flex: 1, marginBottom: 0 }]} />
              <Btn
                label="Set"
                small
                onPress={() =>
                  Radio.command({
                    action: 'p25_ccs',
                    mhz: ccText
                      .split(/[\s,;]+/)
                      .map((x) => parseFloat(x))
                      .filter((x) => x > 25),
                  })
                }
              />
            </View>
            {!!p?.ccs && p.ccs.length > p.settings.ccs.length && (
              <Text style={[ui.muted, { fontSize: 12, marginTop: 6 }]}>
                Also heard from the system: {p.ccs.slice(p.settings.ccs.length).map(fmtMHz).join(', ')}
              </Text>
            )}
            <View style={[ui.row, { gap: 8, marginTop: 14 }]}>
              <Text style={[ui.text, { flex: 1 }]}>Stay on a channel after a call ends</Text>
              <Btn label="−" small onPress={() => Radio.command({ action: 'p25_hang', ms: Math.max(0, (p?.settings.hangMs ?? 1200) - 500) })} />
              <Text style={[ui.text, { fontFamily: mono, width: 44, textAlign: 'center' }]}>{((p?.settings.hangMs ?? 1200) / 1000).toFixed(1)} s</Text>
              <Btn label="+" small onPress={() => Radio.command({ action: 'p25_hang', ms: Math.min(10000, (p?.settings.hangMs ?? 1200) + 500) })} />
            </View>
          </Card>
          <Card>
            <SectionTitle>Talkgroup names</SectionTitle>
            <Text style={[ui.muted, { fontSize: 12, lineHeight: 17 }]}>
              Paste a CSV: RadioReference's talkgroup export (Decimal, Hex, Alpha Tag, Mode, Description, Tag, Category) or lines of "id, name,
              category".
            </Text>
            <TextInput value={csv} onChangeText={setCsv} multiline placeholder="659,CMPD Cntrl Disp,CMPD" placeholderTextColor={C.muted} style={[st.search, st.csv]} />
            <View style={[ui.row, { gap: 8 }]}>
              <Btn
                label="Import"
                small
                primary
                disabled={!csv.trim()}
                onPress={() => {
                  Radio.command({ action: 'p25_import', text: csv });
                  setCsv('');
                }}
              />
              <Btn label="Forget my names" small onPress={() => Radio.command({ action: 'p25_names_reset' })} />
            </View>
          </Card>
          {rx && (
            <Card>
              <SectionTitle>Receiver</SectionTitle>
              <Text style={st.stats}>
                {[
                  `demodulator ${rx.path === 'cqpsk' ? 'CQPSK / LSM' : 'C4FM'} · AFC ${rx.afc.toFixed(0)} Hz · sync error ${rx.quality.toFixed(2)}`,
                  `frames ${rx.frames} · NID failures ${rx.nidFails} · TSBKs ${rx.tsbks} (${rx.tsbkFails} bad)`,
                  `TDMA: ${rx.p2.locked ? `locked, slot ${rx.p2.slot}` : 'not locked'} · MAC ${rx.p2.macs} (${rx.p2.macFails} bad) · voice frames ${rx.p2.voice}`,
                  `grants ${p?.grants ?? 0} · channel changes ${rx.retunes} · audio buffer ${rx.audioMs} ms`,
                  p && p.wacn ? `WACN ${p.wacn.toString(16).toUpperCase()}` : '',
                ]
                  .filter(Boolean)
                  .join('\n')}
              </Text>
              {!!p?.adjacent?.length && (
                <Text style={[st.stats, { marginTop: 8 }]}>Neighbour sites: {p.adjacent.map((a) => `${a.site} ${fmtMHz(a.f)}`).join(', ')}</Text>
              )}
              {!!p?.patches?.length && (
                <Text style={[st.stats, { marginTop: 8 }]}>Patches: {p.patches.map((x) => `${x.sg} = ${x.tgs.join('+')}`).join(', ')}</Text>
              )}
            </Card>
          )}
        </>
      }
    />
  );
}

const st = StyleSheet.create({
  views: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
  warn: { color: C.amber },
  empty: { color: C.muted, paddingHorizontal: 16, paddingTop: 14 },
  now: { color: C.text, fontSize: 20, fontWeight: '800', flex: 1 },
  light: { width: 10, height: 10, borderRadius: 5 },
  meta: { color: C.muted, fontSize: 12, marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line },
  name: { color: C.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  lock: { fontSize: 12 },
  flag: { color: C.muted, fontSize: 20, paddingHorizontal: 4 },
  filters: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 8 },
  search: {
    color: C.text,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.panel2,
    fontSize: 14,
    marginBottom: 4,
  },
  csv: { minHeight: 90, textAlignVertical: 'top', fontFamily: mono, fontSize: 12, marginVertical: 10 },
  stats: { color: C.muted, fontSize: 12, fontFamily: mono, lineHeight: 18 },
});
