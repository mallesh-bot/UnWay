import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, TextInput, View } from "react-native";
import { useStore } from "../store";
import { t } from "../i18n";
import { C } from "../theme";
import { sha256Hex } from "../logic";
import { flushEvents, getFix, onSyncResults } from "../sync";
import { Body, Btn, Card, H1, Screen, s } from "../components/ui";

/** Mandatory Empty Bus Check, then completes the trip. */
export function EmptyBusCheckScreen({ onBack, onDone }: { onBack: () => void; onDone: (synced: boolean) => void }) {
  const { lang, boot, attendantId, driverId, send } = useStore();
  const [checks, setChecks] = useState([false, false, false]);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const person = boot?.crew.find((c) => c.id === attendantId) ?? boot?.crew.find((c) => c.id === driverId);

  async function confirm() {
    if (person?.pin_hash && (await sha256Hex(`${person.id}:${pin}`)) !== person.pin_hash) { Alert.alert(t(lang, "wrongPin")); setPin(""); return; }
    setBusy(true);
    send({ kind: "empty_check", crew_id: person?.id ?? null, data: { items: ["last_row", "under_seats", "no_child_or_bag"] } });
    const complete = send({ kind: "complete" });
    // wait up to 10 s for the server to confirm completion
    const result = await new Promise<"ok" | "unresolved" | "offline">((resolve) => {
      const timer = setTimeout(() => { off(); resolve("offline"); }, 10_000);
      const off = onSyncResults((rs) => {
        const r = rs.find((x) => x.id === complete.id);
        if (!r) return;
        clearTimeout(timer); off();
        resolve(r.ok ? "ok" : r.code === "UNRESOLVED" ? "unresolved" : "ok");
      });
      void flushEvents();
    });
    setBusy(false);
    if (result === "unresolved") { Alert.alert(t(lang, "everyoneAccounted")); onBack(); return; }
    onDone(result === "ok");
  }

  return (
    <Screen>
      <Btn variant="ghost" title="←" onPress={onBack} style={{ alignSelf: "flex-start" }} />
      <H1>{t(lang, "emptyBusTitle")}</H1>
      <Card style={{ backgroundColor: C.warnSoft, borderColor: C.bus }}><Body>{t(lang, "emptyBusSub")}</Body></Card>
      {(["ebc1", "ebc2", "ebc3"] as const).map((k, i) => (
        <Pressable key={k} onPress={() => setChecks(checks.map((v, j) => (j === i ? !v : v)))}
          style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 14, backgroundColor: C.white, borderWidth: 2, borderColor: checks[i] ? C.safe : C.line }}>
          <View style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 3, borderColor: checks[i] ? C.safe : C.ink3, backgroundColor: checks[i] ? C.safe : C.white, alignItems: "center", justifyContent: "center" }}>
            {checks[i] ? <Text style={{ color: "white", fontWeight: "800", fontSize: 18 }}>✓</Text> : null}
          </View>
          <Text style={{ flex: 1, fontSize: 18, fontWeight: "700", color: C.ink }}>{t(lang, k)}</Text>
        </Pressable>
      ))}
      {person?.pin_hash ? (
        <Card style={{ gap: 8 }}>
          <Body>{t(lang, "ebcConfirm")} · {person.name}</Body>
          <TextInput style={[s.input, { fontSize: 28, letterSpacing: 10, textAlign: "center" }]} keyboardType="number-pad" secureTextEntry maxLength={6} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ""))} />
        </Card>
      ) : null}
      {busy ? <ActivityIndicator size="large" color={C.ink} /> : (
        <Btn big variant="safe" title={t(lang, "confirm")} disabled={!checks.every(Boolean) || (!!person?.pin_hash && pin.length < 4)} onPress={confirm} />
      )}
    </Screen>
  );
}

export function DoneScreen({ synced, onHome }: { synced: boolean; onHome: () => void }) {
  const { lang } = useStore();
  return (
    <Screen style={{ alignItems: "center", paddingTop: 60 }}>
      <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: C.safe, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "white", fontSize: 64, fontWeight: "800" }}>✓</Text>
      </View>
      <H1>{t(lang, "tripDone")}</H1>
      <Body style={{ textAlign: "center" } as object}>{synced ? t(lang, "tripDoneSub") : t(lang, "waitingSync")}</Body>
      <Btn big variant="primary" title={t(lang, "backHome")} onPress={onHome} style={{ alignSelf: "stretch" }} />
    </Screen>
  );
}

/** SOS: choose type, send, fall back to SMS/call when offline. */
export function SosScreen({ onClose }: { onClose: () => void }) {
  const { lang, send, boot, trip } = useStore();
  const [state, setState] = useState<"choose" | "sending" | "sent" | "offline">("choose");
  const [type, setType] = useState("");
  const phone = trip?.school?.desk_phone ?? boot?.campus?.desk_phone ?? "";

  async function fire(kind: string) {
    setType(kind); setState("sending");
    const ev = send({ kind: "sos", data: { type: kind } });
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { off(); resolve(false); }, 15_000);
      const off = onSyncResults((rs) => { if (rs.some((r) => r.id === ev.id)) { clearTimeout(timer); off(); resolve(true); } });
      void flushEvents();
    });
    setState(ok ? "sent" : "offline");
  }
  useEffect(() => { /* keep screen simple */ }, []);

  const f = getFix();
  const smsBody = `SOS UnWay Bus ${boot?.bus.display_number}: ${type}. ${f ? `https://maps.google.com/?q=${f.lat},${f.lng}` : ""}`;
  const choices: [string, "accident" | "breakdown" | "medical" | "security" | "other"][] = [
    ["accident", "accident"], ["breakdown", "breakdown"], ["medical", "medical"], ["security", "security"], ["other", "other"],
  ];

  return (
    <Screen>
      <View style={{ backgroundColor: C.alert, borderRadius: 16, padding: 18 }}>
        <Text style={{ color: "white", fontSize: 30, fontWeight: "800" }}>{t(lang, "sosTitle")}</Text>
        <Text style={{ color: "white", fontSize: 16, marginTop: 4 }}>{t(lang, "sosSub")}</Text>
      </View>
      {state === "choose" && choices.map(([k, label]) => <Btn key={k} big variant={k === "accident" || k === "medical" ? "danger" : "secondary"} title={t(lang, label)} onPress={() => fire(k)} />)}
      {state === "sending" && <ActivityIndicator size="large" color={C.alert} />}
      {state === "sent" && <Card style={{ backgroundColor: C.safeSoft }}><Text style={{ fontSize: 20, fontWeight: "800", color: C.safe }}>{t(lang, "sosSent")}</Text></Card>}
      {state === "offline" && <Card style={{ backgroundColor: C.alertSoft }}><Text style={{ fontSize: 18, fontWeight: "800", color: C.alert }}>{t(lang, "sosQueued")}</Text></Card>}
      {phone ? <>
        {state === "offline" && <Btn big variant="danger" title={t(lang, "sendSms")} onPress={() => Linking.openURL(`sms:${phone.replace(/\s/g, "")}?body=${encodeURIComponent(smsBody)}`)} />}
        <Btn big variant="primary" title={`${t(lang, "callSchool")} · ${phone}`} onPress={() => Linking.openURL(`tel:${phone.replace(/\s/g, "")}`)} />
      </> : null}
      <Btn title={t(lang, "backHome")} onPress={onClose} />
    </Screen>
  );
}
