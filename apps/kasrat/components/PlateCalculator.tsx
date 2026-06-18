import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { C, F, FONT, HEAT, heatForFraction } from '@/constants/theme';
import { ForgedNumber } from '@/components/ui/ForgedNumber';
import { DEFAULT_BAR, platesPerSide } from '@/engine/plates';
import { haptics } from '@/components/ui/haptics';

type Props = {
  visible: boolean;
  weight: number;
  bar?: number;
  onClose: () => void;
};

// Heat by plate size — bigger plates run hotter (45 white-hot, 2.5 a dull ember).
function heatForPlate(p: number): string {
  return heatForFraction(p / 45);
}

// Tactile plate calculator: the per-side breakdown for a target barbell weight,
// rendered as stacked heat-colored chips with the achievable load forged below.
export function PlateCalculator({ visible, weight, bar = DEFAULT_BAR, onClose }: Props) {
  useEffect(() => {
    if (visible) haptics.tap();
  }, [visible]);

  const { perSide, achieved, leftover } = platesPerSide(weight, bar);
  const loaded = perSide.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        {/* Stop propagation so taps inside the card don't dismiss. */}
        <Pressable style={s.card} onPress={() => {}}>
          <Text style={s.kicker}>PER SIDE</Text>

          <View style={s.stack}>
            {loaded ? (
              perSide.map((p, i) => {
                const color = heatForPlate(p);
                return (
                  <View key={`${p}-${i}`} style={[s.plate, { borderColor: color, backgroundColor: color + '1f' }]}>
                    <Text style={[s.plateText, { color }]}>{p}</Text>
                  </View>
                );
              })
            ) : (
              <Text style={s.barOnly}>bar only</Text>
            )}
          </View>

          <View style={s.achievedWrap}>
            <ForgedNumber
              value={achieved}
              size={52}
              color={HEAT.white}
              glow
              glowColor={HEAT.hot}
              glowIntensity={0.8}
            />
            <Text style={s.achievedUnit}>lb on the bar</Text>
          </View>

          <Text style={s.barNote}>{bar} lb bar</Text>
          {leftover !== 0 ? (
            <Text style={s.leftover}>≈ closest with your plates</Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  card: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  kicker: {
    color: C.text3,
    fontSize: F.xs,
    fontFamily: FONT.bold,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  stack: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    minHeight: 40,
    alignItems: 'center',
  },
  plate: {
    minWidth: 44,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plateText: {
    fontFamily: FONT.black,
    fontSize: F.lg,
    fontVariant: ['tabular-nums'],
  },
  barOnly: { color: C.text3, fontSize: F.sm, fontFamily: FONT.medium },
  achievedWrap: { alignItems: 'center', marginTop: 18 },
  achievedUnit: { color: C.text2, fontSize: F.sm, fontFamily: FONT.medium, marginTop: 2 },
  barNote: { color: C.text3, fontSize: F.xs, fontFamily: FONT.medium, marginTop: 12 },
  leftover: { color: C.text3, fontSize: F.xs, fontFamily: FONT.regular, marginTop: 4, fontStyle: 'italic' },
});
