import { useEffect, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import * as Location from "expo-location";
import * as Battery from "expo-battery";
import * as Application from "expo-application";
import { useCameraPermissions } from "expo-camera";
import { useStore } from "../store";
import { t } from "../i18n";
import { C } from "../theme";
import { locationCount, queueCount } from "../db";
import { flushEvents, flushLocations } from "../sync";
import { Body, Btn, Card, H1, Screen } from "../components/ui";

function Row({ label, ok, onFix, value }: { label: string; ok: boolean | null; onFix?: () => void; value?: string }) {
  const { lang } = useStore();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line }}>
      <Text style={{ fontSize: 22 }}>{ok == null ? "…" : ok ? "✅" : "❌"}</Text>
      <Text style={{ flex: 1, fontSize: 17, fontWeight: "700", color: C.ink }}>{label}{value ? ` · ${value}` : ""}</Text>
      {ok === false && onFix ? <Btn title={t(lang, "fix")} onPress={onFix} style={{ minHeight: 40 }} /> : null}
    </View>
  );
}

export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { lang, boot, unpair } = useStore();
  const [cam, requestCam] = useCameraPermissions();
  const [fg, setFg] = useState<boolean | null>(null);
  const [bg, setBg] = useState<boolean | null>(null);
  const [gps, setGps] = useState<boolean | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [queues, setQueues] = useState({ events: 0, points: 0 });

  async function refresh() {
    setFg((await Location.getForegroundPermissionsAsync()).granted);
    setBg((await Location.getBackgroundPermissionsAsync()).granted);
    setGps(await Location.hasServicesEnabledAsync());
    setBattery(Math.round((await Battery.getBatteryLevelAsync()) * 100));
    setQueues({ events: queueCount(), points: locationCount() });
  }
  useEffect(() => { void refresh(); }, []);

  return (
    <Screen>
      <Btn variant="ghost" title={`← ${t(lang, "backHome")}`} onPress={onBack} style={{ alignSelf: "flex-start" }} />
      <H1>{t(lang, "settings")}</H1>
      <Card>
        <Row label={t(lang, "permCamera")} ok={cam?.granted ?? null} onFix={() => requestCam()} />
        <Row label={t(lang, "permLocation")} ok={fg == null ? null : !!(fg && bg)} onFix={async () => {
          await Location.requestForegroundPermissionsAsync(); const r = await Location.requestBackgroundPermissionsAsync();
          if (!r.granted) void Linking.openSettings(); void refresh();
        }} />
        <Row label={t(lang, "permGps")} ok={gps} onFix={() => Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS").catch(() => Linking.openSettings())} />
        <Row label={t(lang, "battery")} ok={battery == null ? null : battery > 20} value={battery != null ? `${battery}%` : undefined} />
      </Card>
      <Card style={{ backgroundColor: C.warnSoft }}>
        <Body>{t(lang, "batteryTip")}</Body>
        <Btn title="Open app settings" onPress={() => Linking.openSettings()} style={{ marginTop: 10 }} />
      </Card>
      <Card style={{ gap: 6 }}>
        <Body>{t(lang, "pending", { n: queues.events })} · GPS points {queues.points}</Body>
        <Btn title={t(lang, "refresh")} onPress={async () => { await flushEvents(); await flushLocations(true); await refresh(); }} />
      </Card>
      <Body muted>Bus {boot?.bus.display_number} · {boot?.org.name} · {t(lang, "version")} {Application.nativeApplicationVersion ?? "dev"}</Body>
      <Btn variant="ghost" title="Unpair this phone" onPress={() => Alert.alert("Unpair?", "This phone will stop working for this bus until it is paired again.", [
        { text: t(lang, "cancel"), style: "cancel" }, { text: "Unpair", style: "destructive", onPress: () => { void unpair(); } },
      ])} />
    </Screen>
  );
}
