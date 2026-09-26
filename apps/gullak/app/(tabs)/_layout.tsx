import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { C } from '@/constants/theme';

// Glyph icon that picks up the tab's active/inactive tint via `color`.
function TabGlyph({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={[styles.icon, { color }]}>{glyph}</Text>;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.bar,
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.text3,
        tabBarLabelStyle: styles.label,
        tabBarIconStyle: styles.iconSlot,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <TabGlyph glyph="⊙" color={color} /> }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: ({ color }) => <TabGlyph glyph="≡" color={color} /> }} />
      <Tabs.Screen name="debts" options={{ title: 'Debts', tabBarIcon: ({ color }) => <TabGlyph glyph="◔" color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color }) => <TabGlyph glyph="⋯" color={color} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(12,14,13,0.97)',
    borderTopColor: C.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 64,
    paddingTop: 6,
    paddingBottom: 8,
  },
  iconSlot: { height: 22 },
  icon: { fontSize: 20 },
  label: { fontSize: 11, fontWeight: '600' },
});
