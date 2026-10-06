import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useKeepAwake } from "expo-keep-awake";
import { stateAfter, useStore } from "../store";
import { t } from "../i18n";
import { C, STATE_COLOR } from "../theme";
import { atSchool, counts, evaluateScan, fmtTime, stopAt } from "../logic";
import { feedback } from "../feedback";
import { onFix, setFix } from "../sync";
import { Avatar, Body, Btn, Card, Pill, TopBar, s } from "../components/ui";
import Scanner, { type Overlay } from "../components/Scanner";
import { ChoiceSheet, ManualSheet, ResolveSheet, type ResolveOption } from "../components/Sheets";
import type { Fix, Rider, Stop } from "../types";

type Tab = "stop" | "waiting" | "onbus" | "done";
type ResolveMode = { kind: "stop"; stop: Stop; riders: Rider[] } | { kind: "depart"; riders: Rider[] } | { kind: "finish"; riders: Rider[] };

export default function TripScreen({ onSos, onFinish, onHome }: { onSos: () => void; onFinish: () => void; onHome: () => void }) {
  useKeepAwake();
  const store = useStore();
  const { trip, boot, lang, notices, dismissNotice, send, updateRider, addRider, markScanned, lastScan, setTripField } = store;
  const [fix, setFixState] = useState<Fix | null>(null);
  const [tab, setTab] = useState<Tab>("stop");
  const [scanning, setScanning] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [manual, setManual] = useState(false);
  const [resolve, setResolve] = useState<ResolveMode | null>(null);
  const [sheet, setSheet] = useState<"arrive" | "delay" | null>(null);
  const prevStop = useRef<string | null>(null);
  const visited = useRef<Set<string>>(new Set(trip?.stops.filter((x) => x.entered_at).map((x) => x.id) ?? []));
  const asked = useRef<Set<string>>(new Set());

  // foreground GPS for the UI (background task keeps uploading separately)
  useEffect(() => {
    const off = onFix(setFixState);
    let sub: Location.LocationSubscription | null = null;
    Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 10 }, (l) => {
      setFix({ lat: l.coords.latitude, lng: l.coords.longitude, acc: l.coords.accuracy, speed: l.coords.speed, heading: l.coords.heading, ts: l.timestamp });
    }).then((s2) => { sub = s2; }).catch(() => {});
    return () => { off(); sub?.remove(); };
  }, []);

  const direction = trip?.trip.direction ?? "MORNING";
  const here = useMemo(() => (trip ? stopAt(trip.stops, fix) : null), [trip, fix]);
  const inSchool = useMemo(() => (trip ? atSchool(trip, fix) : false), [trip, fix]);
  if (here) visited.current.add(here.id);
  const nextStop = trip?.stops.find((x) => !visited.current.has(x.id) && !x.entered_at) ?? null;
  const focusStop = here ?? nextStop;

  // automation: reaching school on the morning trip opens the arrival check by itself;
  // leaving school on the afternoon trip without pressing "Depart" runs the departure check.
  const wasInSchool = useRef(inSchool);
  useEffect(() => {
    if (!trip) return;
    const was = wasInSchool.current;
    wasInSchool.current = inSchool;
    if (direction === "MORNING" && inSchool && !was && !trip.trip.arrived_at && sheet === null) { setSheet("arrive"); feedback("warn"); }
    if (direction === "AFTERNOON" && was && !inSchool && !trip.trip.departed_school_at) departSchool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inSchool]);

  // stop departure check
  useEffect(() => {
    if (!trip) return;
    const prev = prevStop.current;
    prevStop.current = here?.id ?? null;
    if (!prev || prev === here?.id || asked.current.has(prev)) return;
    const stop = trip.stops.find((x) => x.id === prev);
    if (!stop) return;
    const riders = trip.manifest.filter((r) => r.stop_id === prev && (direction === "MORNING" ? r.state === "EXPECTED" : r.state === "ON_BOARD"));
    if (riders.length) { asked.current.add(prev); setResolve({ kind: "stop", stop, riders }); feedback("warn"); }
  }, [here?.id, trip, direction]);

  const c = trip ? counts(trip) : { expected: 0, onBoard: 0, dropped: 0, waiting: 0, missing: 0 };

  const handleCode = useCallback((raw: string) => {
    if (!trip || !boot) return;
    const v = evaluateScan(raw, trip, boot, lastScan);
    const now = new Date().toISOString();
    switch (v.kind) {
      case "ok": {
        updateRider(v.rider.student_id, v.type === "BOARD" ? { state: "ON_BOARD", board_at: now } : { state: stateAfter("DEBOARD"), drop_at: now });
        markScanned(v.rider.student_id);
        send({ kind: "scan", data: { qr: raw, type: v.type } });
        feedback("ok");
        setOverlay({ tone: "ok", title: v.type === "BOARD" ? t(lang, "boarded") : direction === "MORNING" ? t(lang, "reachedSchool") : t(lang, "gotOff"),
          name: v.rider.name, photo: v.rider.photo, detail: v.rider.special_care ? `⚠ ${v.rider.special_care}` : v.rider.class });
        break;
      }
      case "handover":
        feedback("warn");
        setOverlay({ tone: "warn", title: t(lang, "handoverRequired"), name: v.rider.name, photo: v.rider.photo, actions: [
          { label: t(lang, "handedOver"), variant: "safe", onPress: () => {
            updateRider(v.rider.student_id, { state: "HANDED_OVER", drop_at: now }); markScanned(v.rider.student_id);
            send({ kind: "resolve", data: { items: [{ student_id: v.rider.student_id, resolution: "handed_over", note: "guardian at stop" }] } });
            setOverlay(null);
          } },
          { label: t(lang, "keepOnBus"), variant: "danger", onPress: () => {
            markScanned(v.rider.student_id);
            send({ kind: "resolve", data: { items: [{ student_id: v.rider.student_id, resolution: "kept_on_bus" }] } });
            setOverlay(null);
          } },
        ] });
        break;
      case "duplicate":
        feedback("warn");
        setOverlay({ tone: "warn", title: t(lang, "already"), name: v.rider.name, photo: v.rider.photo, detail: fmtTime(v.at) });
        break;
      case "already_dropped":
        feedback("warn");
        setOverlay({ tone: "warn", title: t(lang, "alreadyDropped"), name: v.rider.name, photo: v.rider.photo });
        break;
      case "wrong_bus":
        feedback("error");
        setOverlay({ tone: "warn", title: t(lang, "wrongBus"), detail: t(lang, "belongsTo", { name: v.name, bus: v.bus ?? "?" }), actions: [
          { label: t(lang, "deny"), variant: "primary", onPress: () => { send({ kind: "scan", data: { qr: raw, type: "BOARD" } }); setOverlay(null); } },
          { label: t(lang, "allow"), variant: "secondary", onPress: () => {
            send({ kind: "scan", data: { qr: raw, type: "BOARD", override: "allow_wrong_bus" } });
            addRider({ student_id: `guest-${v.publicId}`, public_id: v.publicId, cred_version: 0, name: v.name, class: "", stop_id: null, state: "ON_BOARD",
              board_at: now, drop_at: null, photo: null, special_care: null, handover_required: false, is_guest: true });
            setOverlay(null);
          } },
        ] });
        break;
      default: {
        feedback("error");
        const detail = v.kind === "revoked" ? t(lang, "oldCard") : v.kind === "other_school" ? t(lang, "otherSchool") : t(lang, "notRegistered");
        if (v.kind === "revoked" || v.kind === "unknown") send({ kind: "scan", data: { qr: raw } });
        setOverlay({ tone: "error", title: t(lang, "invalid"), detail });
      }
    }
  }, [trip, boot, lastScan, lang, direction, updateRider, markScanned, send, addRider]);

  if (!trip || !boot) return null;

  const rows: Rider[] = (() => {
    const m = trip.manifest;
    if (tab === "stop") return focusStop ? m.filter((r) => r.stop_id === focusStop.id) : [];
    if (tab === "waiting") return m.filter((r) => r.state === "EXPECTED" || r.state === "MISSED");
    if (tab === "onbus") return m.filter((r) => r.state === "ON_BOARD");
    return m.filter((r) => ["DROPPED", "HANDED_OVER", "NO_SHOW", "ABSENT_NOTIFIED", "TRANSFERRED", "UNCONFIRMED"].includes(r.state));
  })();

  const stopOptions = (r: Rider): ResolveOption[] => r.state === "ON_BOARD"
    ? [{ value: "dropped_unscanned", label: "droppedNoScan" }, { value: "wait", label: "stillOnBus" }]
    : [{ value: "no_show", label: "notPresent" }, { value: "boarded_unscanned", label: "boardedNoScan" }, { value: "absent", label: "absent" }];

  const departOptions = (): ResolveOption[] => [
    { value: "parent_pickup", label: "parentPickup" }, { value: "absent", label: "absent" }, { value: "no_show", label: "notFound" },
  ];

  const finishOptions = (r: Rider): ResolveOption[] => r.state === "ON_BOARD"
    ? direction === "MORNING"
      ? [{ value: "dropped_unscanned", label: "reachedSchool" }]
      : [{ value: "dropped_unscanned", label: "droppedNoScan" }, { value: "handed_over", label: "handedOver" }]
    : [{ value: "no_show", label: "notPresent" }, { value: "absent", label: "absent" }];

  function applyResolutions(items: { student_id: string; resolution: string }[]) {
    const now = new Date().toISOString();
    for (const it of items) {
      const map: Record<string, Partial<Rider>> = {
        no_show: { state: "MISSED" }, absent: { state: "ABSENT_NOTIFIED" }, parent_pickup: { state: "NO_SHOW" },
        boarded_unscanned: { state: "ON_BOARD", board_at: now }, dropped_unscanned: { state: "DROPPED", drop_at: now },
        handed_over: { state: "HANDED_OVER", drop_at: now },
      };
      if (map[it.resolution]) updateRider(it.student_id, map[it.resolution]);
    }
  }

  function tryFinish() {
    const open = trip!.manifest.filter((r) => r.state === "EXPECTED" || r.state === "ON_BOARD");
    if (open.length) { setResolve({ kind: "finish", riders: open }); return; }
    onFinish();
  }

  function departSchool() {
    const missing = trip!.manifest.filter((r) => r.state === "EXPECTED");
    if (missing.length) { setResolve({ kind: "depart", riders: missing }); return; }
    send({ kind: "depart_school", data: { items: [] } });
    setTripField({ departed_school_at: new Date().toISOString() });
  }

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "stop", label: here ? t(lang, "atStop") : t(lang, "nextStop"), n: focusStop ? trip.manifest.filter((r) => r.stop_id === focusStop.id).length : 0 },
    { key: "waiting", label: t(lang, "remaining"), n: c.waiting + c.missing },
    { key: "onbus", label: t(lang, "onBus"), n: c.onBoard },
    { key: "done", label: t(lang, "dropped"), n: c.dropped },
  ];

  const afternoonAtSchoolPhase = direction === "AFTERNOON" && !trip.trip.departed_school_at;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.surface }} edges={["top", "bottom"]}>
      <TopBar onSos={onSos} right={<Pressable onPress={onHome} hitSlop={10}><Text style={{ color: "white", fontWeight: "700" }}>☰</Text></Pressable>} />

      {notices.map((n, i) => (
        <Pressable key={i} onPress={() => dismissNotice(i)} style={{ backgroundColor: C.alertSoft, padding: 10 }}>
          <Text style={{ color: C.alert, fontWeight: "700" }}>{n}  ✕</Text>
        </Pressable>
      ))}

      <View style={{ padding: 12, gap: 10 }}>
        {/* counters */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[["expected", c.expected, C.ink], ["onBus", c.onBoard, C.route], ["dropped", c.dropped, C.safe], ["missing", c.missing, C.alert]].map(([k, n, col]) => (
            <View key={k as string} style={{ flex: 1, backgroundColor: C.white, borderRadius: 12, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: C.line }}>
              <Text style={{ fontSize: 28, fontWeight: "800", color: col as string }}>{n as number}</Text>
              <Text style={{ fontSize: 12, color: C.ink3, fontWeight: "700" }}>{t(lang, k as "expected")}</Text>
            </View>
          ))}
        </View>

        {/* where are we */}
        <Card style={{ paddingVertical: 10 }}>
          <Text style={{ color: C.ink3, fontWeight: "700" }}>{trip.trip.route_code} · {direction === "MORNING" ? t(lang, "startMorning") : t(lang, "startAfternoon")}</Text>
          <Text style={[s.h2, { marginTop: 2 }]} numberOfLines={1}>
            {inSchool ? `🏫 ${trip.school?.name ?? "School"}` : here ? `${t(lang, "atStop")}: ${here.name}` : nextStop ? `${t(lang, "nextStop")}: ${nextStop.name}` : t(lang, "allStops")}
          </Text>
          {!fix && <Body muted>GPS…</Body>}
        </Card>

        <Btn big variant="bus" title={`▣  ${t(lang, "scan")}`} onPress={() => setScanning(true)} style={{ minHeight: 88 }} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn title={t(lang, "markNoCard")} style={{ flex: 1 }} onPress={() => setManual(true)} />
          <Btn title={t(lang, "reportDelay")} style={{ flex: 1 }} onPress={() => setSheet("delay")} />
        </View>
      </View>

      <View style={{ flexDirection: "row", paddingHorizontal: 12, gap: 6 }}>
        {tabs.map((tb) => (
          <Pressable key={tb.key} onPress={() => setTab(tb.key)} style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center", backgroundColor: tab === tb.key ? C.ink : C.white, borderWidth: 1, borderColor: C.line }}>
            <Text style={{ color: tab === tb.key ? C.white : C.ink2, fontWeight: "800", fontSize: 13 }} numberOfLines={1}>{tb.label}</Text>
            <Text style={{ color: tab === tb.key ? C.bus : C.ink3, fontWeight: "800" }}>{tb.n}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8 }} data={rows} keyExtractor={(r) => r.student_id}
        ListEmptyComponent={<Body muted>{tab === "stop" ? t(lang, "noOneHere") : "–"}</Body>}
        renderItem={({ item: r }) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.white, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.line }}>
            <Avatar uri={r.photo} name={r.name} size={46} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: C.ink }} numberOfLines={1}>{r.name}</Text>
              <Text style={{ color: C.ink3 }} numberOfLines={1}>{r.class}{r.stop_id ? ` · ${trip.stops.find((x) => x.id === r.stop_id)?.name ?? ""}` : ""}</Text>
              {r.special_care ? <Text style={{ color: C.warn, fontWeight: "700" }} numberOfLines={1}>⚠ {r.special_care}</Text> : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Pill text={r.state.replace("_", " ").toLowerCase()} color={STATE_COLOR[r.state] ?? C.ink3} />
              {r.is_guest ? <Pill text={t(lang, "guest")} color={C.warn} /> : null}
              {r.handover_required ? <Text style={{ fontSize: 12, color: C.warn }}>👤</Text> : null}
            </View>
          </View>
        )} />

      <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.white }}>
        {direction === "MORNING" ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            {!trip.trip.arrived_at && <Btn style={{ flex: 1 }} variant="primary" title={t(lang, "arriveSchool")} onPress={() => setSheet("arrive")} />}
            <Btn style={{ flex: 1 }} variant={trip.trip.arrived_at ? "primary" : "secondary"} title={t(lang, "finishTrip")} onPress={tryFinish} />
          </View>
        ) : afternoonAtSchoolPhase ? (
          <Btn variant="primary" title={`${t(lang, "departSchool")}${c.waiting ? ` (${t(lang, "stillMissing", { n: c.waiting })})` : ""}`} onPress={departSchool} />
        ) : (
          <Btn variant="primary" title={t(lang, "finishTrip")} onPress={tryFinish} />
        )}
      </View>

      <Scanner visible={scanning} onClose={() => { setScanning(false); setOverlay(null); }} onCode={handleCode} overlay={overlay}
        clearOverlay={() => setOverlay(null)} counter={`${t(lang, "onBus")} ${c.onBoard} · ${t(lang, "dropped")} ${c.dropped} / ${c.expected}`} />

      <ManualSheet visible={manual} riders={trip.manifest} direction={direction} onClose={() => setManual(false)} onMark={(r, type) => {
        const now = new Date().toISOString();
        updateRider(r.student_id, type === "BOARD" ? { state: "ON_BOARD", board_at: now } : { state: "DROPPED", drop_at: now });
        markScanned(r.student_id);
        send({ kind: "scan", data: { student_id: r.student_id, type, reason: "no card" } });
        feedback("ok"); setManual(false);
      }} />

      <ResolveSheet visible={!!resolve} riders={resolve?.riders ?? []} onClose={() => setResolve(null)}
        title={resolve?.kind === "stop" ? t(lang, "childrenNotBoarded", { n: resolve.riders.length, stop: resolve.stop.name })
          : resolve?.kind === "depart" ? t(lang, "stillMissing", { n: resolve.riders.length }) : t(lang, "everyoneAccounted")}
        options={resolve?.kind === "depart" ? departOptions : resolve?.kind === "finish" ? finishOptions : stopOptions}
        submitLabel={resolve?.kind === "depart" ? t(lang, "departAnyway") : resolve?.kind === "finish" ? t(lang, "finishTrip") : undefined}
        onSubmit={(items) => {
          const real = items.filter((i) => i.resolution !== "wait");
          applyResolutions(real);
          if (resolve?.kind === "depart") {
            send({ kind: "depart_school", data: { items: real } });
            setTripField({ departed_school_at: new Date().toISOString() });
          } else if (real.length) {
            send({ kind: "resolve", data: { items: real } });
          }
          const wasFinish = resolve?.kind === "finish";
          setResolve(null);
          if (wasFinish) onFinish();
        }} />

      <ChoiceSheet visible={sheet === "arrive"} title={t(lang, "arriveSchool")} onClose={() => setSheet(null)} choices={[
        ...(boot.policies.allow_bulk_deboard ? [{ label: t(lang, "checkoutAll", { n: c.onBoard }), variant: "bus" as const, onPress: () => {
          const now = new Date().toISOString();
          trip.manifest.filter((r) => r.state === "ON_BOARD").forEach((r) => updateRider(r.student_id, { state: "DROPPED", drop_at: now }));
          send({ kind: "arrive", data: { bulk_deboard: true } }); setTripField({ arrived_at: now }); setSheet(null); feedback("ok");
        } }] : []),
        { label: t(lang, "scanEach"), onPress: () => { send({ kind: "arrive", data: { bulk_deboard: false } }); setTripField({ arrived_at: new Date().toISOString() }); setSheet(null); setScanning(true); } },
      ]} />

      <ChoiceSheet visible={sheet === "delay"} title={t(lang, "reportDelay")} onClose={() => setSheet(null)} choices={
        (["delayTraffic", "delayBreakdown", "delayWeather"] as const).flatMap((k) => [10, 20].map((m) => ({
          label: `${t(lang, k)} · ~${m} min`, onPress: () => { send({ kind: "delay", data: { reason: t("en", k), minutes: m } }); setSheet(null); feedback("ok"); },
        })))
      } />
    </SafeAreaView>
  );
}
