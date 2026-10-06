import { useRef, useState, type ReactNode } from "react";
import { Animated, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { C } from "../theme";
import { useStore } from "../store";
import { t } from "../i18n";

export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.surface }} edges={["top", "bottom"]}>
      {scroll ? <ScrollView contentContainerStyle={[{ padding: 16, gap: 14 }, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        : <View style={[{ flex: 1 }, style]}>{children}</View>}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) { return <Text style={s.h1}>{children}</Text>; }
export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Text style={[s.body, muted && { color: C.ink3 }, style as object]}>{children}</Text>;
}

type Variant = "primary" | "secondary" | "bus" | "danger" | "safe" | "ghost";
export function Btn({ title, onPress, variant = "secondary", disabled, big, sub, style }: {
  title: string; onPress?: () => void; variant?: Variant; disabled?: boolean; big?: boolean; sub?: string; style?: StyleProp<ViewStyle>;
}) {
  const bg: Record<Variant, string> = { primary: C.ink, secondary: C.white, bus: C.bus, danger: C.alert, safe: C.safe, ghost: "transparent" };
  const fg: Record<Variant, string> = { primary: C.white, secondary: C.ink, bus: C.ink, danger: C.white, safe: C.white, ghost: C.ink2 };
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({ pressed }) => [s.btn, { backgroundColor: bg[variant], minHeight: big ? 76 : 56, opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        borderWidth: variant === "secondary" || variant === "bus" ? 2 : 0, borderColor: variant === "bus" ? C.ink : C.line }, style]}>
      <Text style={[s.btnText, { color: fg[variant], fontSize: big ? 22 : 18 }]}>{title}</Text>
      {sub ? <Text style={{ color: fg[variant], opacity: 0.8, fontSize: 14, marginTop: 2 }}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Plate({ children, large }: { children: ReactNode; large?: boolean }) {
  return (
    <View style={[s.plate, large && { height: 44, minWidth: 64, paddingHorizontal: 12 }]}>
      <Text style={{ fontWeight: "800", fontSize: large ? 24 : 16, color: C.ink }}>{children}</Text>
    </View>
  );
}

export function Avatar({ uri, name, size = 44 }: { uri?: string | null; name: string; size?: number }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.line }} />;
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.routeSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: C.route, fontWeight: "800", fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Pill({ text, color }: { text: string; color: string }) {
  return <View style={{ backgroundColor: color + "22", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}><Text style={{ color, fontWeight: "700", fontSize: 13 }}>{text}</Text></View>;
}

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(30,42,50,.45)", justifyContent: "flex-end" }}>
        <SafeAreaView edges={["bottom"]} style={{ backgroundColor: C.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%" }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderColor: C.line, flexDirection: "row", alignItems: "center" }}>
            <Text style={[s.h2, { flex: 1 }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={16} accessibilityLabel="Close"><Text style={{ fontSize: 26, color: C.ink3 }}>×</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** Status strip: bus plate, online state, pending uploads, SOS (long press). */
export function TopBar({ onSos, right }: { onSos?: () => void; right?: ReactNode }) {
  const { boot, online, pending, lang } = useStore();
  return (
    <View style={s.topbar}>
      <Plate>{boot?.bus.display_number ?? "?"}</Plate>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.white, fontWeight: "700" }} numberOfLines={1}>{boot?.org.name ?? "UnWay"}</Text>
        <Text style={{ color: online ? "#9fe0bf" : "#ffb4ad", fontSize: 13 }}>
          ● {online ? t(lang, "online") : t(lang, "offline")}{pending > 0 ? ` · ${t(lang, "pending", { n: pending })}` : ""}
        </Text>
      </View>
      {right}
      {onSos && <SosButton onFire={onSos} />}
    </View>
  );
}

function SosButton({ onFire }: { onFire: () => void }) {
  const { lang } = useStore();
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);
  const start = () => {
    setHolding(true);
    Animated.timing(progress, { toValue: 1, duration: 1500, useNativeDriver: false }).start(({ finished }) => {
      setHolding(false); progress.setValue(0);
      if (finished) onFire();
    });
  };
  const cancel = () => { progress.stopAnimation(); progress.setValue(0); setHolding(false); };
  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  return (
    <Pressable onPressIn={start} onPressOut={cancel} accessibilityLabel={t(lang, "holdSos")}
      style={{ backgroundColor: C.alert, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, overflow: "hidden", borderWidth: 2, borderColor: C.white }}>
      <Animated.View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width, backgroundColor: "#7a1d17" }} />
      <Text style={{ color: C.white, fontWeight: "800", fontSize: 16 }}>{holding ? "…" : t(lang, "sos")}</Text>
    </Pressable>
  );
}

export const s = StyleSheet.create({
  h1: { fontSize: 26, fontWeight: "800", color: C.ink },
  h2: { fontSize: 20, fontWeight: "800", color: C.ink },
  body: { fontSize: 16, color: C.ink2, lineHeight: 22 },
  btn: { borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  btnText: { fontWeight: "800" },
  plate: { backgroundColor: C.bus, borderWidth: 2, borderColor: C.ink, borderRadius: 6, height: 32, minWidth: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: C.white, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.line },
  topbar: { backgroundColor: C.ink, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  input: { borderWidth: 2, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, height: 54, fontSize: 18, backgroundColor: C.white, color: C.ink },
});
