import {
  NavigationContainer,
  Theme as NavigationTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import * as Screens from "../screens";
import { HomeNavigator } from "./HomeNavigator";

type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

const Stack = createNativeStackNavigator();

const AppStack = () => {
  return (
    <Stack.Navigator initialRouteName={"Home"}>
      <Stack.Screen
        name="HomeStack"
        component={HomeNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Settings" component={Screens.SettingsScreen} />
    </Stack.Navigator>
  );
};

export interface NavigationProps
  extends Partial<React.ComponentProps<typeof NavigationContainer>> {
  theme?: NavigationTheme;
}

export const AppNavigator = ({ theme, ...rest }: NavigationProps) => {
  return (
    <NavigationContainer theme={theme} {...rest}>
      <AppStack />
    </NavigationContainer>
  );
};
