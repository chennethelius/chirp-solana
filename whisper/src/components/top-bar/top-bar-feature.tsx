import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/core";
import { useAuthorization } from "../../utils/useAuthorization";
import { useMobileWallet } from "../../utils/useMobileWallet";
import { ellipsify } from "../../utils/ellipsify";
import { COLORS } from "../../theme";
import { haptic } from "../../utils/haptics";

export function TopBar() {
  const navigation = useNavigation<any>();
  const { selectedAccount } = useAuthorization();
  const { connect } = useMobileWallet();

  const onWalletPress = async () => {
    haptic.tap();
    if (selectedAccount) return;
    try {
      await connect();
    } catch {}
  };

  const goSettings = () => {
    haptic.tap();
    navigation.navigate("Settings");
  };

  return (
    <View style={styles.bar}>
      <Pressable onPress={onWalletPress} style={styles.walletPill}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: selectedAccount ? COLORS.green : COLORS.inkMuted },
          ]}
        />
        <Text style={styles.walletText}>
          {selectedAccount
            ? ellipsify(selectedAccount.publicKey.toBase58())
            : "Connect"}
        </Text>
      </Pressable>
      <Pressable onPress={goSettings} style={styles.cogBtn}>
        <Text style={{ fontSize: 18 }}>⚙️</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 56,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    backgroundColor: COLORS.bg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  walletPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.paper,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  walletText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
    fontFamily: "Courier",
    letterSpacing: 0.4,
  },
  cogBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
});
