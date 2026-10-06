import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarX2, Check, ChevronRight, Clock3, MapPin, Phone, Send, Smartphone } from "lucide-react";
import {
  cancelAbsence, history, portal, rememberPortal, setAbsence, setPrefs, subscribePush, telegramBot,
  type Dir, type Portal, type PortalChild, type PushResult,
} from "./api";
import { tr, type Key, type Lang } from "./i18n";
import ParentShell, { useLang } from "./ParentShell";
import MapView from "../components/MapView";
import { Avatar, Toggle, cx } from "../components/ui";

const TZ = "Asia/Kolkata";
const time = (ts: string | null) => ts ? new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TZ }) : "";
const isoAdd = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const dayLabel = (iso: string, lang: Lang) => new Date(iso + "T00:00:00").toLocaleDateString(lang === "en" ? "en-IN" : lang === "hi" ? "hi-IN" : "te-IN", { weekday: "short", day: "numeric", month: "short" });

export default function ParentPortal() {
  const { token = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [lang, setLangLocal] = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["portal", token], queryFn: () => portal(token), refetchInterval: 30_000, retry: 1 });
  const [childId, setChildId] = useState<string | null>(null);

  useEffect(() => { if (q.data) rememberPortal(token); }, [q.data, token]);
  // first visit: follow the language the school saved for this parent
  useEffect(() => {
    const stored = (() => { try { return localStorage.getItem("unway-lang"); } catch { return null; } })();
    if (!stored && q.data?.guardian.language && q.data.guardian.language !== lang) setLangLocal(q.data.guardian.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.guardian.language]);

  const setLang = (l: Lang) => { setLangLocal(l); setPrefs(token, { language: l }).catch(() => {}); };
  const refresh = () => qc.invalidateQueries({ queryKey: ["portal", token] });

  if (q.isLoading) return <ParentShell lang={lang} setLang={setLang}><Skeleton /></ParentShell>;
  if (q.error || !q.data) {
    const invalid = String((q.error as Error)?.message ?? "").includes("INVALID_LINK");
    return (
      <ParentShell lang={lang} setLang={setLang}>
        <div className="py-16 text-center">
          <h1 className="text-xl font-extrabold">{invalid ? tr(lang, "badCode") : tr(lang, "networkErr")}</h1>
          {invalid && <p className="mt-2 text-ink-3">{tr(lang, "badCodeSub")}</p>}
        </div>
      </ParentShell>
    );
  }

  const p = q.data;
  const child = p.children.find((c) => c.id === childId) ?? p.children[0];
  const first = p.guardian.name.split(" ")[0];
  const kids = p.children.map((c) => c.first_name).join(", ");

  return (
    <ParentShell lang={lang} setLang={setLang} title={p.school.name}>
      <div className="space-y-4">
        <div className="rise">
          <p className="text-sm text-ink-3">{dayLabel(p.today, lang)}</p>
          <h1 className="text-2xl font-extrabold">{tr(lang, "hello", { name: first })}</h1>
        </div>

        {params.get("welcome") && (
          <div className="flex items-start gap-3 rounded-2xl border border-safe/30 bg-safe-soft p-4">
            <Check className="mt-0.5 shrink-0 text-safe" size={20} />
            <p className="flex-1 text-ink-2">{tr(lang, "welcome", { kids })}</p>
            <button className="text-sm font-semibold text-ink-3" onClick={() => { params.delete("welcome"); setParams(params, { replace: true }); }}>OK</button>
          </div>
        )}

        {p.children.length > 1 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
            {p.children.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === child.id} onClick={() => setChildId(c.id)}
                className={cx("flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-4 font-semibold transition-colors",
                  c.id === child.id ? "border-transparent bg-ink text-white shadow-[var(--shadow-soft)]" : "neu-soft neu-press border-transparent text-ink")}>
                <Avatar src={c.photo} name={`${c.first_name} ${c.last_name}`} size={30} /> {c.first_name}
              </button>
            ))}
          </div>
        )}

        {child ? <>
          <TodayCard child={child} lang={lang} />
          <BusDetails child={child} lang={lang} campus={p.school.campus} />
          <AbsencePlanner child={child} lang={lang} token={token} today={p.today} onDone={refresh} />
          <History child={child} lang={lang} token={token} />
        </> : <p className="neu rounded-[22px] p-5 text-ink-3 shadow-card">{tr(lang, "noRoute")}</p>}

        <Notifications p={p} lang={lang} token={token} onDone={refresh} />

        {p.school.campus?.desk_phone && (
          <a href={`tel:${p.school.campus.desk_phone.replace(/\s/g, "")}`}
            className="neu neu-press flex items-center justify-center gap-2 rounded-[22px] py-4 text-lg font-bold">
            <Phone size={20} /> {tr(lang, "callSchool")} · <span className="tabular">{p.school.campus.desk_phone}</span>
          </a>
        )}
        <p className="text-center text-xs text-ink-3">{tr(lang, "homeTip")}</p>
        <p className="text-center text-xs text-ink-3">{tr(lang, "privacy")}</p>
      </div>
    </ParentShell>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy>
      {[48, 160, 120, 180].map((h, i) => <div key={i} className="animate-pulse neu rounded-[22px]/70" style={{ height: h }} />)}
    </div>
  );
}

/* ------------------------------------------------------------------ today */
function legState(lang: Lang, dir: Dir, state: string): string {
  if (dir === "MORNING" && state === "DROPPED") return tr(lang, "reachedSchool");
  return tr(lang, state as Key);
}

function TodayCard({ child, lang }: { child: PortalChild; lang: Lang }) {
  const legs = [...child.today].sort((a, b) => (a.direction === b.direction ? 0 : a.direction === "MORNING" ? -1 : 1));
  const current = legs.find((l) => l.trip_status === "active")
    ?? legs.find((l) => l.trip_status === "scheduled" && l.state === "EXPECTED")
    ?? legs[legs.length - 1];
  const running = current?.trip_status === "active";
  const routeFor = (d: Dir) => child.routes.find((r) => r.direction === d);

  const tone = !current ? "bg-panel text-ink"
    : ["MISSED", "UNCONFIRMED"].includes(current.state) ? "bg-alert text-white"
    : ["DROPPED", "HANDED_OVER"].includes(current.state) ? "bg-safe text-white"
    : current.state === "ON_BOARD" ? "bg-route text-white" : "bg-panel text-ink";

  return (
    <section className={cx("rise overflow-hidden rounded-[28px] shadow-[var(--shadow-card)]", tone)}>
      <div className="p-5">
        <div className="flex items-center gap-3">
          <Avatar src={child.photo} name={`${child.first_name} ${child.last_name}`} size={48} />
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-extrabold leading-tight">{child.first_name}</h2>
            <p className="text-sm opacity-80">{child.class && `${child.class} · `}{tr(lang, "today")}</p>
          </div>
          {running && <span className="ml-auto flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-bold"><span className="live-dot h-2 w-2 rounded-full bg-current" /> {tr(lang, "live")}</span>}
        </div>
        {current ? (
          <>
            <p className="mt-4 text-2xl font-extrabold">{legState(lang, current.direction, current.state)}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm opacity-90">
              {current.bus && <span className="plate" style={{ boxShadow: "none", height: "1.5rem" }}>{current.bus}</span>}
              {tr(lang, current.direction === "MORNING" ? "morning" : "afternoon")}
              {current.board_at && <span className="tabular">· {tr(lang, "boarded")} {time(current.board_at)}</span>}
              {current.drop_at && <span className="tabular">· {time(current.drop_at)}</span>}
              {current.state === "EXPECTED" && routeFor(current.direction)?.time && <span>· {tr(lang, "around", { t: routeFor(current.direction)!.time! })}</span>}
            </p>
          </>
        ) : <p className="mt-4 text-xl font-bold">{tr(lang, "noTrip")}</p>}
      </div>

      {legs.length > 0 && (
        <ol className="grid grid-cols-2 border-t border-black/10 bg-black/5 text-sm">
          {(["MORNING", "AFTERNOON"] as Dir[]).map((d) => {
            const l = legs.find((x) => x.direction === d);
            return (
              <li key={d} className="px-5 py-3 first:border-r first:border-black/10">
                <div className="text-xs font-semibold opacity-70">{tr(lang, d === "MORNING" ? "morningShort" : "afternoonShort")}</div>
                <div className="font-semibold">{l ? legState(lang, d, l.state) : "–"}</div>
                {l && (l.board_at || l.drop_at) && <div className="tabular opacity-80">{[time(l.board_at), time(l.drop_at)].filter(Boolean).join(" → ")}</div>}
              </li>
            );
          })}
        </ol>
      )}

      {running && (
        <a href={`/t/${child.track_token}`} className="flex items-center justify-between bg-ink px-5 py-4 text-lg font-bold text-white">
          <span className="flex items-center gap-2"><MapPin size={20} /> {tr(lang, "trackLive")}</span><ChevronRight />
        </a>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- bus details */
function BusDetails({ child, lang, campus }: { child: PortalChild; lang: Lang; campus: Portal["school"]["campus"] }) {
  const am = child.routes.find((r) => r.direction === "MORNING");
  const pm = child.routes.find((r) => r.direction === "AFTERNOON");
  const markers = useMemo(() => {
    const m: Parameters<typeof MapView>[0]["markers"] = [];
    if (am) m.push({ id: "am", kind: "stop", lat: am.stop_lat, lng: am.stop_lng, label: "", popup: am.stop });
    if (pm && (!am || pm.stop_lat !== am.stop_lat)) m.push({ id: "pm", kind: "stop", lat: pm.stop_lat, lng: pm.stop_lng, label: "", popup: pm.stop });
    if (campus?.lat && campus.lng) m.push({ id: "school", kind: "school", lat: campus.lat, lng: campus.lng, label: campus.name });
    return m;
  }, [am, pm, campus]);
  if (!am && !pm) return <Card title={tr(lang, "busDetails")}><p className="text-ink-3">{tr(lang, "noRoute")}</p></Card>;
  const row = (label: string, r: typeof am) => r && (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="plate shrink-0">{r.bus ?? "–"}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-ink-3">{label}</div>
        <div className="truncate font-bold">{r.stop}</div>
      </div>
      {r.time && <div className="text-right"><div className="flex items-center gap-1 font-bold tabular"><Clock3 size={15} className="text-ink-3" />{r.time}</div></div>}
    </div>
  );
  return (
    <Card title={tr(lang, "busDetails")} pad={false}>
      <div className="divide-y divide-line-2 px-5 py-4">{row(tr(lang, "pickup"), am)}{row(tr(lang, "dropHome"), pm)}</div>
      {markers.length > 0 && <MapView className="h-56 w-full" markers={markers} fitKey={child.id} zoom={14} />}
    </Card>
  );
}

/* --------------------------------------------------------------- absences */
function AbsencePlanner({ child, lang, token, today, onDone }: { child: PortalChild; lang: Lang; token: string; today: string; onDone: () => void }) {
  const [which, setWhich] = useState<"today" | "tomorrow" | "other">("tomorrow");
  const [other, setOther] = useState(isoAdd(today, 2));
  const [legs, setLegs] = useState<"BOTH" | "AM" | "PM">("BOTH");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const date = which === "today" ? today : which === "tomorrow" ? isoAdd(today, 1) : other;

  async function save() {
    setBusy(true); setMsg(null);
    try { await setAbsence(token, child.id, date, legs); setMsg(tr(lang, "saved")); onDone(); }
    catch (e) { setMsg((e as Error).message.includes("DATE") ? "Pick a date in the next 90 days." : (e as Error).message); }
    finally { setBusy(false); }
  }
  const chip = (active: boolean) => cx("rounded-2xl px-3.5 py-2 text-sm font-semibold transition-all duration-300", active ? "bg-surface text-ink shadow-[inset_3px_3px_7px_var(--neu-dark),inset_-3px_-3px_7px_var(--neu-light)] ring-2 ring-bus" : "neu-soft neu-press");

  return (
    <Card title={<span className="flex items-center gap-2"><CalendarX2 size={18} /> {tr(lang, "absTitle")}</span>}>
      <p className="-mt-1 mb-3 text-sm text-ink-3">{tr(lang, "absSub")}</p>
      <div className="flex flex-wrap gap-2">
        <button className={chip(which === "today")} onClick={() => setWhich("today")}>{tr(lang, "absToday")}</button>
        <button className={chip(which === "tomorrow")} onClick={() => setWhich("tomorrow")}>{tr(lang, "absTomorrow")}</button>
        <button className={chip(which === "other")} onClick={() => setWhich("other")}>{tr(lang, "pickDate")}</button>
        {which === "other" && <input type="date" value={other} min={today} max={isoAdd(today, 90)} onChange={(e) => setOther(e.target.value)}
          className="h-10 neu-inset rounded-xl px-3" aria-label={tr(lang, "pickDate")} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["BOTH", "AM", "PM"] as const).map((l) => <button key={l} className={chip(legs === l)} onClick={() => setLegs(l)}>{tr(lang, `leg${l}` as Key)}</button>)}
      </div>
      <button disabled={busy} onClick={save} className="neu-press mt-4 w-full rounded-2xl bg-bus py-3.5 font-display text-lg font-extrabold text-ink shadow-[6px_6px_14px_rgba(190,145,0,.35),-6px_-6px_14px_var(--neu-light),inset_0_-3px_0_var(--color-bus-deep)] disabled:opacity-60">
        {tr(lang, "markAbsent")} · {dayLabel(date, lang)}
      </button>
      {msg && <p className="mt-2 text-center text-sm font-semibold text-ink-2">{msg}</p>}
      {child.absences.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold text-ink-3">{tr(lang, "planned")}</div>
          <ul className="divide-y divide-line-2">
            {child.absences.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span><b>{dayLabel(a.date, lang)}</b> <span className="text-ink-3">· {tr(lang, `leg${a.legs}` as Key)}</span></span>
                <button className="text-sm font-semibold text-alert" onClick={async () => { await cancelAbsence(token, a.id); onDone(); }}>{tr(lang, "cancel")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- history */
function History({ child, lang, token }: { child: PortalChild; lang: Lang; token: string }) {
  const [all, setAll] = useState(false);
  const h = useQuery({ queryKey: ["parent-history", token, child.id], queryFn: () => history(token, child.id, 30) });
  const days = h.data ?? [];
  const dot = (s: string) => ["DROPPED", "HANDED_OVER"].includes(s) ? "bg-safe" : s === "ON_BOARD" ? "bg-route" : ["MISSED", "UNCONFIRMED"].includes(s) ? "bg-alert" : "bg-line";
  return (
    <Card title={tr(lang, "history")}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Mini value={child.stats.rides} label={tr(lang, "rides")} />
        <Mini value={child.stats.missed} label={tr(lang, "missedN")} tone={child.stats.missed ? "alert" : undefined} />
        <Mini value={child.stats.absent} label={tr(lang, "absentN")} />
      </div>
      {days.length === 0 ? <p className="mt-3 text-sm text-ink-3">{h.isLoading ? tr(lang, "loading") : tr(lang, "noHistory")}</p> : (
        <ul className="mt-3 divide-y divide-line-2">
          {(all ? days : days.slice(0, 7)).map((d) => (
            <li key={d.date} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-24 shrink-0 font-semibold">{dayLabel(d.date, lang)}</span>
              <span className="flex flex-1 flex-wrap gap-x-4 gap-y-1">
                {d.legs.map((l, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className={cx("h-2.5 w-2.5 rounded-full", dot(l.state))} />
                    <span className="text-ink-2">{tr(lang, l.direction === "MORNING" ? "morningShort" : "afternoonShort")}</span>
                    <span className="tabular text-ink-3">{l.board_at ? time(l.board_at) : tr(lang, l.state as Key)}</span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {days.length > 7 && !all && <button className="mt-2 text-sm font-semibold text-route" onClick={() => setAll(true)}>{tr(lang, "showMore")}</button>}
    </Card>
  );
}

function Mini({ value, label, tone }: { value: number; label: string; tone?: "alert" }) {
  return (
    <div className="neu-inset rounded-2xl px-2 py-3">
      <div className={cx("text-2xl font-extrabold tabular", tone === "alert" && "text-alert")}>{value}</div>
      <div className="text-xs font-semibold text-ink-3">{label}</div>
    </div>
  );
}

/* ---------------------------------------------------------- notifications */
function Notifications({ p, lang, token, onDone }: { p: Portal; lang: Lang; token: string; onDone: () => void }) {
  const [bot, setBot] = useState("");
  const [push, setPush] = useState<PushResult | "idle" | "busy">("idle");
  useEffect(() => { telegramBot().then(setBot); }, []);
  const status = (c: string) => p.guardian.channels.find((x) => x.channel === c && x.status !== "failed")?.status;
  const anyOn = p.guardian.channels.some((c) => c.status === "active");
  const enabled = p.school.channels ?? {};

  const rows: { key: string; label: string; icon: typeof Send; on?: string; connect?: ReactNode }[] = [];
  if (enabled.telegram !== false) rows.push({
    key: "telegram", label: tr(lang, "tgShort"), icon: Send, on: status("telegram"),
    connect: bot ? <a href={`https://t.me/${bot}?start=${p.guardian.invite_code}`} className="whitespace-nowrap rounded-lg bg-[#229ED9] px-3 py-1.5 text-sm font-bold text-white">{tr(lang, "turnOn")}</a> : <span className="text-sm text-ink-3">{tr(lang, "notReady")}</span>,
  });
  if (enabled.webpush !== false) rows.push({
    key: "webpush", label: tr(lang, "pushShort"), icon: BellRing, on: push === "ok" ? "active" : status("webpush"),
    connect: <button disabled={push === "busy"} onClick={async () => { setPush("busy"); const r = await subscribePush({ portal: token }); setPush(r); if (r === "ok") onDone(); }}
      className="neu-soft neu-press whitespace-nowrap rounded-xl px-3.5 py-1.5 text-sm font-bold">{tr(lang, "turnOn")}</button>,
  });
  if (enabled.whatsapp) rows.push({ key: "whatsapp", label: tr(lang, "waShort"), icon: Smartphone, on: status("whatsapp") });

  return (
    <Card title={<span className="flex items-center gap-2"><BellRing size={18} /> {tr(lang, "alerts")}</span>}>
      {!anyOn && <p className="mb-3 rounded-xl bg-warn-soft p-3 text-sm font-semibold text-warn">{tr(lang, "noChannel")}</p>}
      <ul className="divide-y divide-line-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 py-3">
            <span className="neu-soft grid h-10 w-10 place-items-center rounded-2xl"><r.icon size={18} /></span>
            <span className="flex-1">
              <span className="block font-bold">{r.label}</span>
              {r.on && <span className="text-sm text-ink-3">{r.on === "active" ? tr(lang, "connected") : r.on === "pending" ? "…" : tr(lang, "pausedLbl")}</span>}
            </span>
            {r.on === "active" || r.on === "stopped"
              ? <Toggle label={r.label} checked={r.on === "active"} onChange={async (v) => { await setPrefs(token, { channel: r.key, paused: !v }); onDone(); }} />
              : r.connect}
          </li>
        ))}
      </ul>
      {(push === "unsupported" || push === "denied" || push === "error") && (
        <p className="mt-2 text-sm text-ink-3">{push === "unsupported" ? tr(lang, "pushUnsupported") : push === "denied" ? tr(lang, "pushDenied") : "Something went wrong. Please try again."}</p>
      )}
    </Card>
  );
}

function Card({ title, children, pad = true }: { title: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="rise overflow-hidden neu rounded-[22px]">
      <h2 className="px-6 pt-5 text-[17px] font-extrabold">{title}</h2>
      <div className={pad ? "px-6 pb-6 pt-3" : "pt-2"}>{children}</div>
    </section>
  );
}
