import { useEffect, useRef, useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStore } from "../store";
import { t } from "../i18n";
import { C } from "../theme";
import { Btn } from "./ui";

export type Overlay =
  | { tone: "ok"; title: string; name: string; photo?: string | null; detail?: string }
  | { tone: "warn" | "error"; title: string; name?: string; photo?: string | null; detail?: string;
      actions?: { label: string; variant?: "primary" | "secondary" | "danger" | "safe"; onPress: () => void }[] };

/** Full-screen continuous QR scanner with a result overlay. */
export default function Scanner({ visible, onClose, onCode, overlay, clearOverlay, counter }: {
  visible: boolean; onClose: () => void; onCode: (data: string) => void;
  overlay: Overlay | null; clearOverlay: () => void; counter: string;
}) {
  const { lang } = useStore();
  const [perm, requestPerm] = useCameraPermissions();
  const last = useRef<{ data: string; at: number }>({ data: "", at: 0 });
  const [torch, setTorch] = useState(false);

  useEffect(() => { if (visible && perm && !perm.granted) void requestPerm(); }, [visible, perm, requestPerm]);

  // auto-dismiss green results
  useEffect(() => {
    if (overlay?.tone === "ok") { const id = setTimeout(clearOverlay, 1500); return () => clearTimeout(id); }
    if (overlay && !("actions" in overlay && overlay.actions?.length)) { const id = setTimeout(clearOverlay, 3000); return () => clearTimeout(id); }
  }, [overlay, clearOverlay]);

  const bg = overlay?.tone === "ok" ? C.safe : overlay?.tone === "warn" ? C.warn : C.alert;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "black" }}>
        {perm?.granted ? (
          <CameraView style={{ flex: 1 }} facing="back" enableTorch={torch} barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={overlay ? undefined : ({ data }) => {
              const now = Date.now();
              if (data === last.current.data && now - last.current.at < 3000) return;
              last.current = { data, at: now };
              onCode(data);
            }} />
        ) : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontSize: 18 }}>Camera permission needed</Text></View>}

        {/* aiming frame */}
        {!overlay && (
          <View pointerEvents="none" style={{ position: "absolute", top: "22%", left: "12%", right: "12%", aspectRatio: 1, borderWidth: 4, borderColor: C.bus, borderRadius: 24 }} />
        )}

        <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: 12, gap: 10 }}>
            <Text style={{ color: "white", fontSize: 18, fontWeight: "800", flex: 1 }}>{counter}</Text>
            <Pressable onPress={() => setTorch(!torch)} style={{ backgroundColor: "rgba(255,255,255,.2)", padding: 10, borderRadius: 10 }}>
              <Text style={{ color: "white", fontWeight: "700" }}>{torch ? "✕ " : ""}{t(lang, "light")}</Text>
            </Pressable>
          </View>
        </SafeAreaView>

        <SafeAreaView edges={["bottom"]} style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 16 }}>
          <Btn variant="secondary" title={t(lang, "doneScanning")} onPress={onClose} />
        </SafeAreaView>

        {overlay && (
          <Pressable onPress={() => !("actions" in overlay && overlay.actions?.length) && clearOverlay()}
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: bg, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 }}>
            {overlay.photo ? <Image source={{ uri: overlay.photo }} style={{ width: 180, height: 180, borderRadius: 90, borderWidth: 6, borderColor: "white" }} /> : null}
            <Text style={{ color: "white", fontSize: 40, fontWeight: "800", textAlign: "center" }}>{overlay.title}</Text>
            {overlay.name ? <Text style={{ color: "white", fontSize: 30, fontWeight: "800", textAlign: "center" }}>{overlay.name}</Text> : null}
            {overlay.detail ? <Text style={{ color: "white", fontSize: 20, textAlign: "center" }}>{overlay.detail}</Text> : null}
            {"actions" in overlay && overlay.actions?.length ? (
              <View style={{ alignSelf: "stretch", gap: 10, marginTop: 12 }}>
                {overlay.actions.map((a) => <Btn key={a.label} big variant={a.variant ?? "secondary"} title={a.label} onPress={a.onPress} />)}
              </View>
            ) : <Text style={{ color: "white", opacity: 0.8, marginTop: 10 }}>{t(lang, "tapToClose")}</Text>}
          </Pressable>
        )}
      </View>
    </Modal>
  );
}
