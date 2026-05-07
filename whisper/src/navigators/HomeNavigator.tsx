import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import { Text } from "react-native";

import { TopBar } from "../components/top-bar/top-bar-feature";
import { HomeScreen } from "../screens/HomeScreen";
import { CustomerScreen } from "../screens/CustomerScreen";
import { MerchantScreen } from "../screens/MerchantScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { ReceiptsScreen } from "../screens/ReceiptsScreen";
import { COLORS } from "../theme";

const Tab = createBottomTabNavigator();

const ICONS: Record<string, string> = {
  Home: "🐦",
  Pay: "🎧",
  Receipts: "🧾",
  Receive: "📡",
  Settings: "⚙️",
};

export function HomeNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        header: () => <TopBar />,
        tabBarActiveTintColor: COLORS.ink,
        tabBarInactiveTintColor: COLORS.inkMuted,
        tabBarStyle: {
          backgroundColor: COLORS.paper,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: 70,
          paddingBottom: 12,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontWeight: "600",
          fontSize: 11,
          letterSpacing: 0.4,
          marginTop: 2,
        },
        tabBarIcon: ({ focused, size }) => {
          const glyph = ICONS[route.name] ?? "•";
          return (
            <Text
              style={{
                fontSize: size,
                opacity: focused ? 1 : 0.4,
                transform: [{ scale: focused ? 1 : 0.92 }],
              }}
            >
              {glyph}
            </Text>
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Pay" component={CustomerScreen} />
      <Tab.Screen name="Receipts" component={ReceiptsScreen} />
      <Tab.Screen name="Receive" component={MerchantScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
