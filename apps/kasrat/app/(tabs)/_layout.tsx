import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { C, F } from '@/constants/theme';

function TabIcon({ focused, label, icon }: { focused: boolean; label: string; icon: string }) {
  return (
    <View style={styles.tab}>
      <Text style={[styles.icon, focused && styles.iconActive]}>{icon}</Text>
      <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.bar,
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.text3,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} label="Today" icon="⊙" />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} label="History" icon="◷" />,
        }}
      />
      <Tabs.Screen
        name="programs"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} label="Programs" icon="≡" />,
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} label="Exercises" icon="⊞" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(13,13,16,0.97)',
    borderTopColor: C.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 64,
    paddingBottom: 8,
  },
  tab: { alignItems: 'center', gap: 2, paddingTop: 4 },
  icon: { fontSize: 20, color: C.text3 },
  iconActive: { color: C.accent },
  label: { fontSize: F.xs - 1, fontWeight: '600', color: C.text3 },
  labelActive: { color: C.accent },
});
