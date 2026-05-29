import { useState } from 'react';
import {
  FlatList,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISES, MUSCLES } from '@/store/exercises';
import { C, F } from '@/constants/theme';

export default function ExercisesScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const filtered = query
    ? EXERCISES.filter(
        e =>
          e.name.toLowerCase().includes(query.toLowerCase()) ||
          e.muscle.toLowerCase().includes(query.toLowerCase())
      )
    : null;

  const sections = MUSCLES.map(muscle => ({
    title: muscle,
    data: EXERCISES.filter(e => e.muscle === muscle),
  }));

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.pageHeader}>
        <Text style={styles.title}>Exercises</Text>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Search..."
        placeholderTextColor={C.text3}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        clearButtonMode="while-editing"
      />

      {filtered ? (
        <FlatList
          data={filtered}
          keyExtractor={e => e.id}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.exRow}>
              <Text style={styles.exName}>{item.name}</Text>
              <Text style={styles.exMeta}>{item.muscle} · {item.equipment}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No matches.</Text>
          }
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={e => e.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionLabel}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <View style={styles.exRow}>
              <Text style={styles.exName}>{item.name}</Text>
              <Text style={styles.exEquip}>{item.equipment}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  pageHeader: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: F.xxxl, fontWeight: '700', color: C.text },
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: C.text,
    fontSize: F.base,
  },
  list: { flex: 1 },
  listContent: { paddingBottom: 100 },
  sectionLabel: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
    fontSize: F.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: C.accent,
  },
  exRow: {
    marginHorizontal: 16,
    marginBottom: 6,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  exName: { color: C.text, fontSize: F.sm, fontWeight: '600', flex: 1 },
  exMeta: { color: C.text2, fontSize: F.xs },
  exEquip: { color: C.text3, fontSize: F.xs },
  empty: { paddingHorizontal: 20, paddingTop: 20, color: C.text3, fontSize: F.sm },
});
