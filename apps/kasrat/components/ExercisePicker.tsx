import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISES, MUSCLES } from '@/store/exercises';
import type { Exercise } from '@/types';
import { C, F } from '@/constants/theme';

type Props = {
  visible: boolean;
  onSelect: (exercise: Exercise) => void;
  onClose: () => void;
};

export function ExercisePicker({ visible, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const filtered = EXERCISES.filter(e => {
    const matchQuery = !query || e.name.toLowerCase().includes(query.toLowerCase());
    const matchMuscle = !muscle || e.muscle === muscle;
    return matchQuery && matchMuscle;
  });

  function handleSelect(ex: Exercise) {
    onSelect(ex);
    setQuery('');
    setMuscle(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <View style={s.handle} />
        <TextInput
          style={s.search}
          placeholder="Search exercises..."
          placeholderTextColor={C.text3}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <FlatList
          data={MUSCLES}
          keyExtractor={m => m}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.muscles}
          renderItem={({ item: m }) => (
            <TouchableOpacity
              style={[s.muscleChip, muscle === m && s.muscleChipActive]}
              onPress={() => setMuscle(muscle === m ? null : m)}
            >
              <Text style={[s.muscleChipText, muscle === m && s.muscleChipTextActive]}>{m}</Text>
            </TouchableOpacity>
          )}
        />
        <FlatList
          data={filtered}
          keyExtractor={e => e.id}
          style={s.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: ex }) => (
            <TouchableOpacity style={s.exRow} onPress={() => handleSelect(ex)}>
              <Text style={s.exName}>{ex.name}</Text>
              <Text style={s.exMeta}>{ex.muscle} · {ex.equipment}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={s.empty}>Nothing. Try a different search.</Text>
          }
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  search: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: C.text,
    fontSize: F.base,
  },
  muscles: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 10,
  },
  muscleChip: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  muscleChipActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  muscleChipText: {
    color: C.text2,
    fontSize: F.xs,
    fontWeight: '600',
  },
  muscleChipTextActive: {
    color: '#fff',
  },
  list: {
    flex: 1,
  },
  exRow: {
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  exName: {
    color: C.text,
    fontSize: F.base,
    fontWeight: '600',
  },
  exMeta: {
    color: C.accent,
    fontSize: F.xs,
    marginTop: 2,
    fontWeight: '600',
  },
  empty: {
    color: C.text3,
    textAlign: 'center',
    padding: 32,
    fontSize: F.sm,
  },
});
