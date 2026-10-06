import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Device from "expo-device";
import * as Application from "expo-application";
import { callRpc, saveConfig } from "../api";
import { useStore } from "../store";
import { t } from "../i18n";
import { C } from "../theme";
import { Body, Btn, Card, H1, Screen, s } from "../components/ui";

interface PairResult { device_token: string; device_id: string }

export default function PairScreen() {
  const { lang, onPaired } = useStore();
  const [perm, requestPerm] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [code, setCode] = useState("");
  const handled = useRef(false);

  async function pair(u: string, k: string, c: string) {
    setBusy(true);
    try {
      const res = await callRpc<PairResult>(u, k, "dev_pair", {
        p_code: c,
        p_info: { model: `${Device.manufacturer ?? ""} ${Device.modelName ?? ""}`.trim(), os_version: Device.osVersion, app_version: Application.nativeApplicationVersion ?? "dev" },
      });
      await saveConfig({ url: u, key: k, token: res.device_token, deviceId: res.device_id });
      await onPaired();
    } catch (e) {
      const msg = String((e as Error).message);
      Alert.alert("Pairing failed", msg.includes("PAIRING_CODE_INVALID") ? "This code is wrong or expired. Create a new one in the dashboard." : msg);
      handled.current = false;
    } finally { setBusy(false); }
  }

  if (scanning) {
    return (
      <View style={{ flex: 1, backgroundColor: "black" }}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={busy ? undefined : ({ data }) => {
            if (handled.current) return;
            try {
              const j = JSON.parse(data);
              if (j.t !== "unway-pair" || !j.u || !j.k || !j.c) return;
              handled.current = true;
              setScanning(false);
              void pair(j.u, j.k, j.c);
            } catch { /* not our code */ }
          }} />
        <View style={{ position: "absolute", bottom: 40, left: 16, right: 16 }}>
          <Btn title={t(lang, "cancel")} onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <View style={{ alignItems: "center", marginTop: 24, gap: 8 }}>
        <View style={[s.plate, { height: 64, minWidth: 64 }]}><Text style={{ fontSize: 30, fontWeight: "800" }}>U</Text></View>
        <H1>{t(lang, "pairTitle")}</H1>
        <Body muted style={{ textAlign: "center" } as object}>{t(lang, "pairSub")}</Body>
      </View>
      {busy ? <ActivityIndicator size="large" color={C.ink} /> : (
        <>
          <Btn big variant="bus" title={t(lang, "scanPairing")} onPress={async () => {
            if (!perm?.granted) { const r = await requestPerm(); if (!r.granted) return; }
            handled.current = false; setScanning(true);
          }} />
          <Card style={{ gap: 10 }}>
            <Body muted>{t(lang, "typeCode")}</Body>
            <TextInput style={s.input} placeholder="https://xxxx.supabase.co" autoCapitalize="none" autoCorrect={false} value={url} onChangeText={setUrl} />
            <TextInput style={s.input} placeholder={t(lang, "serverKey")} autoCapitalize="none" autoCorrect={false} value={key} onChangeText={setKey} />
            <TextInput style={[s.input, { letterSpacing: 4, fontWeight: "800" }]} placeholder="ABCD2345" autoCapitalize="characters" maxLength={8} value={code} onChangeText={setCode} />
            <Btn variant="primary" title={t(lang, "pair")} disabled={!url || !key || code.length < 8} onPress={() => pair(url.trim(), key.trim(), code.trim())} />
          </Card>
        </>
      )}
    </Screen>
  );
}
