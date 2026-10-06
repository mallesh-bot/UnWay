import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Application from "expo-application";
import { useStore } from "../store";
import { t, type Lang } from "../i18n";
import { C } from "../theme";
import { compareVersions, fmtTime } from "../logic";
import { Body, Btn, Card, Pill, TopBar, s } from "../components/ui";
import type { TripSummary } from "../types";

export default function HomeScreen({ onStart, onSos, onSettings, onResume }: {
  onStart: (trip: TripSummary) => void; onSos: () => void; onSettings: () => void; onResume: () => void;
}) {
  const { boot, trip, lang, setLang, refreshBoot } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const minVersion = boot?.policies.min_app_version;
  const outdated = minVersion && Application.nativeApplicationVersion && compareVersions(Application.nativeApplicationVersion, minVersion) < 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.surface }} edges={["top", "bottom"]}>
      <TopBar onSos={onSos} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refreshBoot(); setRefreshing(false); }} />}>
        {outdated ? <Card style={{ backgroundColor: C.warnSoft }}><Body>Please update the UnWay Bus app (required {minVersion}).</Body></Card> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[s.plate, { height: 56, minWidth: 76 }]}><Text style={{ fontSize: 30, fontWeight: "800" }}>{boot?.bus.display_number}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.h2}>{boot?.bus.registration_no ?? ""}</Text>
            <Body muted>{boot?.org.name}</Body>
          </View>
        </View>

        {trip && trip.trip.status === "active" && (
          <Btn big variant="bus" title={t(lang, "resume")} sub={`${trip.trip.route_code} · ${trip.trip.direction === "MORNING" ? t(lang, "startMorning") : t(lang, "startAfternoon")}`} onPress={onResume} />
        )}

        <Text style={[s.h2, { marginTop: 4 }]}>{t(lang, "today")}</Text>
        {!boot?.trips.length && <Body muted>{t(lang, "noTrips")}</Body>}
        {boot?.trips.map((tr) => {
          const done = ["completed", "completed_forced", "aborted_auto", "cancelled"].includes(tr.status);
          const isActiveHere = trip?.trip.id === tr.id;
          return (
            <Card key={tr.id} style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={[s.h2, { flex: 1 }]}>{tr.route_code} · {fmtTime(tr.scheduled_start)}</Text>
                <Pill text={done ? t(lang, "completed") : tr.status === "active" ? "●" : t(lang, "notStarted")} color={done ? C.safe : tr.status === "active" ? C.route : C.ink3} />
              </View>
              <Body muted>{tr.route_name} · {tr.expected} {t(lang, "expected").toLowerCase()}</Body>
              {!done && !isActiveHere && (
                <Btn variant={tr.status === "active" ? "bus" : "primary"} big
                  title={tr.status === "active" ? t(lang, "resume") : tr.direction === "MORNING" ? t(lang, "startMorning") : t(lang, "startAfternoon")}
                  onPress={() => onStart(tr)} />
              )}
            </Card>
          );
        })}

        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          {(["en", "te", "hi"] as Lang[]).map((l) => (
            <Pressable key={l} onPress={() => setLang(l)} style={{ flex: 1, padding: 12, borderRadius: 10, borderWidth: 2, borderColor: lang === l ? C.ink : C.line, backgroundColor: C.white, alignItems: "center" }}>
              <Text style={{ fontWeight: "800", color: C.ink }}>{{ en: "English", te: "తెలుగు", hi: "हिंदी" }[l]}</Text>
            </Pressable>
          ))}
        </View>
        <Btn variant="ghost" title={t(lang, "settings")} onPress={onSettings} />
        <Btn variant="ghost" title={t(lang, "refresh")} onPress={() => refreshBoot()} />
      </ScrollView>
    </SafeAreaView>
  );
}
