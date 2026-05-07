// Polyfills
import "./src/polyfills";

import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { ConnectionProvider } from "./src/utils/ConnectionProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme as NavigationDarkTheme } from "@react-navigation/native";
import {
  PaperProvider,
  MD3DarkTheme,
  adaptNavigationTheme,
} from "react-native-paper";
import { AppNavigator } from "./src/navigators/AppNavigator";
import { ClusterProvider } from "./src/components/cluster/cluster-data-access";
import { COLORS } from "./src/theme";

const queryClient = new QueryClient();

// Dark mode app-wide. Whisper's design system is built around a near-black
// canvas with Duolingo-green accents. We pin Paper + Navigation themes here so
// nothing fights us on the system color scheme.
const { DarkTheme } = adaptNavigationTheme({
  reactNavigationDark: NavigationDarkTheme,
});

const PaperDark = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: COLORS.green,
    secondary: COLORS.greenBright,
    background: COLORS.bg,
    surface: COLORS.paper,
    surfaceVariant: COLORS.paperDeep,
    onBackground: COLORS.ink,
    onSurface: COLORS.ink,
    onSurfaceVariant: COLORS.inkSoft,
    outline: COLORS.border,
    error: COLORS.red,
  },
};

const NavDark = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: COLORS.bg,
    card: COLORS.paper,
    text: COLORS.ink,
    border: COLORS.border,
    primary: COLORS.green,
    notification: COLORS.green,
  },
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ClusterProvider>
        <ConnectionProvider config={{ commitment: "processed" }}>
          <SafeAreaView
            style={[styles.shell, { backgroundColor: COLORS.bg }]}
          >
            <StatusBar style="light" />
            <PaperProvider theme={PaperDark}>
              <AppNavigator theme={NavDark} />
            </PaperProvider>
          </SafeAreaView>
        </ConnectionProvider>
      </ClusterProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
});
