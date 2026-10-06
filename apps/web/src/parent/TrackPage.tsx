import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useParams } from "react-router-dom";
import { rememberedPortal, snapshot, type Snapshot } from "./api";
import { tr, type Key, type Lang } from "./i18n";
import ParentShell, { useLang } from "./ParentShell";

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const STYLE = (import.meta.env.VITE_MAP_STYLE as string) || "https://tiles.openfreemap.org/styles/liberty";

function time(ts: string | null) {
  return ts ? new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
}

export default function TrackRoute() {
  const { token = "" } = useParams();
  const [lang, setLang] = useLang();
  const portal = rememberedPortal();
  return (
    <ParentShell lang={lang} setLang={setLang}>
      <TrackPage token={token} lang={lang} />
      {portal && <a href={`/p/${portal}`} className="mt-4 block neu rounded-[18px] py-3 text-center font-bold text-route shadow-card">{tr(lang, "openDashboard")}</a>}
    </ParentShell>
  );
}

export function TrackPage({ token, lang }: { token: string; lang: Lang }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState(false);
  const [, tick] = useState(0);
  const runningRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = async () => {
      if (document.visibilityState === "hidden") { timer = window.setTimeout(load, 15000); return; }
      try { const s = await snapshot(token); runningRef.current = s.trip?.status === "active"; if (alive) { setSnap(s); setErr(false); } }
      catch { if (alive) setErr(true); }
      // poll faster while the bus is running
      if (alive) timer = window.setTimeout(load, runningRef.current ? 12000 : 60000);
    };
    load();
    const t2 = window.setInterval(() => tick((x) => x + 1), 5000);
    return () => { alive = false; window.clearTimeout(timer); window.clearInterval(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!snap) return <p className="py-16 text-center text-ink-3">{err ? tr(lang, "networkErr") : tr(lang, "loading")}</p>;
  if (!snap.ok) return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-extrabold">{tr(lang, "expired")}</h1>
      <p className="mt-2 text-ink-3">{tr(lang, "expiredSub")}</p>
    </div>
  );

  const trip = snap.trip;
  const stateKey = (trip?.state ?? "") as Key;
  const running = trip?.status === "active";
  const ageS = snap.live ? Math.round((Date.now() - new Date(snap.live.updated_at).getTime()) / 1000) : null;
  const stale = running && ageS != null && ageS > 180;
  const tone = trip?.state === "MISSED" || trip?.state === "UNCONFIRMED" ? "bg-alert text-white"
    : trip?.state === "DROPPED" || trip?.state === "HANDED_OVER" ? "bg-safe text-white"
    : trip?.state === "ON_BOARD" ? "bg-route text-white" : "bg-panel text-ink";

  return (
    <div className="space-y-4">
      <section className={`rounded-2xl p-5 shadow-card ${tone}`}>
        <p className="text-sm opacity-80">{snap.school}</p>
        <h1 className="text-3xl font-extrabold leading-tight">{snap.child}</h1>
        {trip ? (
          <>
            <p className="mt-1 text-xl font-bold">{trip.direction === "MORNING" && trip.state === "DROPPED" ? tr(lang, "reachedSchool") : tr(lang, stateKey)}</p>
            <p className="mt-2 flex items-center gap-2 text-sm opacity-90">
              <span className="plate" style={{ boxShadow: "none" }}>{trip.bus ?? "?"}</span>
              {tr(lang, trip.direction === "MORNING" ? "morning" : "afternoon")} · {running ? tr(lang, "live") : trip.status === "scheduled" ? tr(lang, "notStarted") : tr(lang, "finished")}
            </p>
          </>
        ) : <p className="mt-1 text-lg">{tr(lang, "noTrip")}</p>}
      </section>

      {snap.eta && running && (
        <p className="neu rounded-[22px] p-4 text-lg font-bold shadow-card">{tr(lang, "eta", { m: snap.eta.minutes, to: snap.eta.to })}</p>
      )}
      {stale && <p className="rounded-xl bg-alert-soft p-3 text-alert">{tr(lang, "stale")}</p>}

      {running && snap.live && <BusMap snap={snap} />}
      {running && ageS != null && (
        <p className="text-center text-sm text-ink-3">{tr(lang, "updated", { s: ageS < 60 ? tr(lang, "secAgo", { n: ageS }) : tr(lang, "minAgo", { n: Math.round(ageS / 60) }) })}</p>
      )}

      {snap.events.length > 0 && (
        <section className="neu rounded-[22px] p-4 shadow-card">
          <ol className="space-y-3">
            {snap.events.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${e.state === "DROPPED" || e.state === "HANDED_OVER" ? "bg-safe" : e.state === "ON_BOARD" ? "bg-route" : e.state === "MISSED" ? "bg-alert" : "bg-line"}`} />
                <div>
                  <div className="font-bold">{tr(lang, e.direction === "MORNING" ? "morning" : "afternoon")} · {tr(lang, "bus")} {e.bus}</div>
                  <div className="text-ink-2">
                    {e.board_at && <span className="tabular">{tr(lang, "boarded")} {time(e.board_at)}</span>}
                    {e.drop_at && <span className="tabular"> · {e.direction === "MORNING" ? tr(lang, "reachedSchool") : tr(lang, "droppedAt")} {time(e.drop_at)}</span>}
                    {!e.board_at && !e.drop_at && tr(lang, e.state as Key)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {snap.campus?.desk_phone && (
        <a href={`tel:${snap.campus.desk_phone.replace(/\s/g, "")}`} className="neu neu-press block rounded-[22px] py-4 text-center text-lg font-bold">{tr(lang, "callSchool")}</a>
      )}
      <p className="text-center text-xs text-ink-3">{tr(lang, "privacy")}</p>
    </div>
  );
}

function BusMap({ snap }: { snap: Snapshot }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const bus = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!box.current || !snap.live) return;
    const m = new maplibregl.Map({ container: box.current, style: STYLE, center: [snap.live.lng, snap.live.lat], zoom: 14, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    for (const s of snap.stops) {
      const el = document.createElement("div");
      el.style.cssText = s.mine
        ? "width:22px;height:22px;border-radius:50%;background:#1F8A5B;border:3px solid #fff;box-shadow:0 0 0 2px #1F8A5B"
        : "width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid #2F6FB0";
      new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).setPopup(new maplibregl.Popup({ closeButton: false }).setText(s.name)).addTo(m);
    }
    if (snap.campus?.lat && snap.campus.lng) {
      const el = document.createElement("div");
      el.style.cssText = "width:26px;height:26px;border-radius:7px;background:#1E2A32;color:#F2B705;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #F2B705";
      el.textContent = "S";
      new maplibregl.Marker({ element: el }).setLngLat([snap.campus.lng, snap.campus.lat]).addTo(m);
    }
    const busEl = document.createElement("div");
    busEl.style.cssText = "background:#F2B705;border:2px solid #1E2A32;border-radius:6px;padding:2px 8px;font-weight:800;box-shadow:0 2px 8px rgba(0,0,0,.35)";
    busEl.textContent = `🚌 ${snap.trip?.bus ?? ""}`;
    bus.current = new maplibregl.Marker({ element: busEl }).setLngLat([snap.live.lng, snap.live.lat]).addTo(m);
    // fit bus + my stop
    const mine = snap.stops.find((s) => s.mine);
    if (mine) {
      const b = new maplibregl.LngLatBounds([snap.live.lng, snap.live.lat], [snap.live.lng, snap.live.lat]);
      b.extend([mine.lng, mine.lat]);
      m.fitBounds(b, { padding: 50, maxZoom: 16, duration: 0 });
    }
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (snap.live && bus.current) bus.current.setLngLat([snap.live.lng, snap.live.lat]);
  }, [snap.live]);

  return <div ref={box} className="h-80 w-full overflow-hidden rounded-2xl" />;
}
