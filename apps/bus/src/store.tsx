import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import * as Battery from "expo-battery";
import * as Location from "expo-location";
import * as Application from "expo-application";
import { clearConfig, isUnauthorized, loadConfig, rpc } from "./api";
import { kvDel, kvGet, kvSet, locationCount, pendingForTrip, queueCount, wipeAll } from "./db";
import { flushEvents, flushLocations, onOnline, onSyncResults, onUnpaired, queueEvent, type SyncResult } from "./sync";
import { startTracking, stopTracking } from "./locationTask";
import type { Lang } from "./i18n";
import type { Bootstrap, Config, CustodyState, QueuedEvent, Rider, TripData } from "./types";

interface Store {
  ready: boolean;
  config: Config | null;
  boot: Bootstrap | null;
  trip: TripData | null;
  lang: Lang;
  online: boolean;
  pending: number;
  notices: string[];
  lastScan: Record<string, number>;
  driverId: string | null;
  attendantId: string | null;
  setLang: (l: Lang) => void;
  onPaired: () => Promise<void>;
  refreshBoot: () => Promise<void>;
  startTrip: (tripId: string, driverId: string, attendantId: string) => Promise<void>;
  reloadTrip: () => Promise<void>;
  updateRider: (studentId: string, patch: Partial<Rider>) => void;
  addRider: (r: Rider) => void;
  markScanned: (studentId: string) => void;
  send: (e: Omit<QueuedEvent, "id" | "ts" | "lat" | "lng" | "acc" | "trip_id">) => QueuedEvent;
  setTripField: (patch: Partial<TripData["trip"]>) => void;
  endTrip: () => Promise<void>;
  dismissNotice: (i: number) => void;
  unpair: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export function useStore(): Store { const s = useContext(Ctx); if (!s) throw new Error("no store"); return s; }

const SCAN_LABEL: Record<string, string> = {
  invalid: "card not valid", revoked: "old card", unknown: "card not registered", other_org: "card from another school",
  wrong_bus: "wrong bus", not_enrolled: "not registered for transport", duplicate: "already scanned",
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(kvGet<Bootstrap>("boot"));
  const [trip, setTrip] = useState<TripData | null>(() => {
    const id = kvGet<string>("active_trip_id");
    return id ? kvGet<TripData>(`trip:${id}`) : null;
  });
  const [lang, setLangState] = useState<Lang>(kvGet<Lang>("lang") ?? "en");
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [notices, setNotices] = useState<string[]>([]);
  const [lastScan, setLastScan] = useState<Record<string, number>>({});
  const [driverId, setDriverId] = useState<string | null>(kvGet<string>("driver_id"));
  const [attendantId, setAttendantId] = useState<string | null>(kvGet<string>("attendant_id"));
  const tripRef = useRef(trip);
  tripRef.current = trip;

  const persistTrip = useCallback((t: TripData | null) => {
    if (t) kvSet(`trip:${t.trip.id}`, t);
    setTrip(t);
  }, []);

  const refreshBoot = useCallback(async () => {
    try {
      const b = await rpc<Bootstrap>("dev_bootstrap");
      kvSet("boot", b); setBoot(b); setOnline(true);
    } catch (e) {
      if (isUnauthorized(e)) await doUnpair(); else setOnline(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doUnpair = useCallback(async () => {
    await stopTracking().catch(() => {});
    await clearConfig(); wipeAll();
    setConfig(null); setBoot(null); setTrip(null);
  }, []);

  // initial load
  useEffect(() => {
    (async () => {
      const c = await loadConfig();
      setConfig(c);
      setReady(true);
      if (c) { await refreshBoot(); await flushEvents(); }
    })();
  }, [refreshBoot]);

  /** Server manifest + any local changes still waiting to upload. */
  const reloadTrip = useCallback(async () => {
    const t = tripRef.current;
    if (!t) return;
    try {
      const fresh = await rpc<TripData>("dev_trip_data", { p_trip_id: t.trip.id });
      if (pendingForTrip(t.trip.id).length === 0) {
        persistTrip(fresh);
      } else {
        // keep local states for riders touched by pending events
        const local = Object.fromEntries(t.manifest.map((r) => [r.student_id, r]));
        const touched = new Set(pendingForTrip(t.trip.id).flatMap((e) => {
          const d = e.data ?? {};
          const ids = [d.student_id as string | undefined, ...((d.items as { student_id: string }[] | undefined)?.map((i) => i.student_id) ?? [])];
          return ids.filter(Boolean) as string[];
        }));
        persistTrip({ ...fresh, manifest: fresh.manifest.map((r) => (touched.has(r.student_id) && local[r.student_id] ? local[r.student_id] : r)) });
      }
      setOnline(true);
    } catch (e) {
      if (isUnauthorized(e)) await doUnpair(); else setOnline(false);
    }
  }, [persistTrip, doUnpair]);

  // react to server results for queued events
  useEffect(() => {
    const off1 = onSyncResults((results: SyncResult[]) => {
      const msgs: string[] = [];
      for (const r of results) {
        if (r.ok === false && r.result && r.result !== "duplicate" && r.result !== "wrong_bus") {
          msgs.push(`Server: ${(r.name as string) ?? "a scan"} – ${SCAN_LABEL[r.result] ?? r.result}`);
        }
        if (r.ok === false && r.code === "UNRESOLVED") msgs.push("Some children still need a status before finishing.");
      }
      if (msgs.length) setNotices((n) => [...n, ...msgs].slice(-5));
      setPending(queueCount());
      void reloadTrip();
    });
    const off2 = onUnpaired(() => { void doUnpair(); });
    const off3 = onOnline(setOnline);
    return () => { off1(); off2(); off3(); };
  }, [reloadTrip, doUnpair]);

  // periodic sync, heartbeat, battery
  useEffect(() => {
    if (!config) return;
    const tick = async () => {
      try { kvSet("battery", Math.round((await Battery.getBatteryLevelAsync()) * 100)); } catch { /* ignore */ }
      await flushEvents();
      await flushLocations(true);
      setPending(queueCount() + (locationCount() > 50 ? 1 : 0));
    };
    const hb = async () => {
      try {
        await rpc("dev_heartbeat", { p_info: {
          battery: kvGet<number>("battery"), gps_enabled: await Location.hasServicesEnabledAsync().catch(() => null),
          pending: queueCount(), app_version: Application.nativeApplicationVersion ?? "dev",
        } });
        setOnline(true);
      } catch (e) { if (isUnauthorized(e)) await doUnpair(); else setOnline(false); }
    };
    void tick(); void hb();
    const a = setInterval(tick, 10_000);
    const b = setInterval(hb, 60_000);
    const c = setInterval(() => { if (tripRef.current) void reloadTrip(); }, 30_000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") { void tick(); void refreshBoot(); } });
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); sub.remove(); };
  }, [config, reloadTrip, refreshBoot, doUnpair]);

  const startTrip = useCallback(async (tripId: string, d: string, a: string) => {
    const f = await Location.getLastKnownPositionAsync().catch(() => null);
    const data = await rpc<TripData>("dev_start_trip", {
      p_trip_id: tripId, p_driver_id: d, p_attendant_id: a,
      p_lat: f?.coords.latitude ?? null, p_lng: f?.coords.longitude ?? null, p_device_ts: new Date().toISOString(),
    });
    kvSet("active_trip_id", tripId); kvSet("driver_id", d); kvSet("attendant_id", a);
    setDriverId(d); setAttendantId(a);
    persistTrip(data);
    setLastScan({});
    await startTracking(boot?.bus.display_number ?? "");
  }, [persistTrip, boot]);

  const updateRider = useCallback((studentId: string, patch: Partial<Rider>) => {
    const t = tripRef.current; if (!t) return;
    persistTrip({ ...t, manifest: t.manifest.map((r) => (r.student_id === studentId ? { ...r, ...patch } : r)) });
  }, [persistTrip]);

  const addRider = useCallback((r: Rider) => {
    const t = tripRef.current; if (!t) return;
    persistTrip({ ...t, manifest: [...t.manifest.filter((x) => x.student_id !== r.student_id), r] });
  }, [persistTrip]);

  const setTripField = useCallback((patch: Partial<TripData["trip"]>) => {
    const t = tripRef.current; if (!t) return;
    persistTrip({ ...t, trip: { ...t.trip, ...patch } });
  }, [persistTrip]);

  const send = useCallback((e: Omit<QueuedEvent, "id" | "ts" | "lat" | "lng" | "acc" | "trip_id">) => {
    const ev = queueEvent({ ...e, trip_id: tripRef.current?.trip.id ?? null });
    setPending(queueCount());
    return ev;
  }, []);

  const endTrip = useCallback(async () => {
    await stopTracking().catch(() => {});
    const t = tripRef.current;
    if (t) kvDel(`trip:${t.trip.id}`);
    kvDel("active_trip_id");
    setTrip(null);
    await refreshBoot();
  }, [refreshBoot]);

  const value: Store = {
    ready, config, boot, trip, lang, online, pending, notices, lastScan, driverId, attendantId,
    setLang: (l) => { kvSet("lang", l); setLangState(l); },
    onPaired: async () => { setConfig(await loadConfig()); await refreshBoot(); },
    refreshBoot, startTrip, reloadTrip, updateRider, addRider,
    markScanned: (id) => setLastScan((m) => ({ ...m, [id]: Date.now() })),
    send, setTripField, endTrip,
    dismissNotice: (i) => setNotices((n) => n.filter((_, j) => j !== i)),
    unpair: doUnpair,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function stateAfter(type: "BOARD" | "DEBOARD"): CustodyState { return type === "BOARD" ? "ON_BOARD" : "DROPPED"; }
