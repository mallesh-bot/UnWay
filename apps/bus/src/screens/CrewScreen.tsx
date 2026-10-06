import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import { useStore } from "../store";
import { t } from "../i18n";
import { C } from "../theme";
import { sha256Hex } from "../logic";
import { Body, Btn, Card, H1, Screen, s } from "../components/ui";
import type { Crew, TripSummary } from "../types";

function Choice({ people, value, onChange }: { people: Crew[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      {people.map((p) => (
        <Pressable key={p.id} onPress={() => onChange(p.id)}
          style={{ padding: 16, borderRadius: 12, borderWidth: 2, borderColor: value === p.id ? C.ink : C.line, backgroundColor: value === p.id ? C.bus : C.white }}>
          <Text style={{ fontSize: 18, fontWeight: "800", color: C.ink }}>{p.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function CrewScreen({ trip, onBack, onStarted }: { trip: TripSummary; onBack: () => void; onStarted: () => void }) {
  const { boot, lang, startTrip, driverId, attendantId } = useStore();
  const drivers = boot?.crew.filter((c) => c.role === "driver") ?? [];
  const attendants = boot?.crew.filter((c) => c.role === "attendant") ?? [];
  const [driver, setDriver] = useState<string | null>(driverId && drivers.some((d) => d.id === driverId) ? driverId : drivers[0]?.id ?? null);
  const [att, setAtt] = useState<string | null>(attendantId && attendants.some((d) => d.id === attendantId) ? attendantId : attendants[0]?.id ?? null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    const person = boot?.crew.find((c) => c.id === att) ?? boot?.crew.find((c) => c.id === driver);
    if (!person) return;
    if (!person.pin_hash) { Alert.alert(t(lang, "noPinSet")); return; }
    if ((await sha256Hex(`${person.id}:${pin}`)) !== person.pin_hash) { Alert.alert(t(lang, "wrongPin")); setPin(""); return; }
    setBusy(true);
    try {
      await startTrip(trip.id, driver!, att ?? driver!);
      onStarted();
    } catch (e) {
      Alert.alert("Could not start trip", String((e as Error).message).includes("TRIP_ALREADY_CLOSED") ? "This trip is already closed." : "Check the network and try again.\n" + (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <Btn variant="ghost" title={`← ${t(lang, "backHome")}`} onPress={onBack} style={{ alignSelf: "flex-start" }} />
      <H1>{t(lang, "whoIsOnBus")}</H1>
      <Body muted>{trip.route_code} · {trip.route_name}</Body>
      <Text style={s.h2}>{t(lang, "driver")}</Text>
      {drivers.length ? <Choice people={drivers} value={driver} onChange={setDriver} /> : <Body muted>Add drivers in the dashboard.</Body>}
      <Text style={s.h2}>{t(lang, "attendant")}</Text>
      {attendants.length ? <Choice people={attendants} value={att} onChange={setAtt} /> : <Body muted>No attendants added. The driver's PIN will be used.</Body>}
      <Card style={{ gap: 10 }}>
        <Body>{attendants.length ? t(lang, "enterPin") : `${t(lang, "driver")} PIN`}</Body>
        <TextInput style={[s.input, { fontSize: 28, letterSpacing: 10, textAlign: "center" }]} keyboardType="number-pad" secureTextEntry maxLength={6} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ""))} />
      </Card>
      {busy ? <ActivityIndicator size="large" color={C.ink} /> : (
        <Btn big variant="bus" title={t(lang, "start")} disabled={!driver || pin.length < 4} onPress={go} />
      )}
    </Screen>
  );
}
