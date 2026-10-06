import { useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, BellRing, Bus, CalendarClock, Check, CircleDashed, Gauge, KeyRound, MapPinned, MessageSquareText,
  Moon, Radar, Route as RouteIcon, School, Siren, Smartphone, Sparkles, TimerReset, Users, WifiOff,
} from "lucide-react";
import { useAuth, useSettings } from "../lib/auth";
import { friendlyError, rpc, supabase } from "../lib/supabase";
import type { ExceptionRow, LiveBoard as LB } from "../lib/types";
import { EXCEPTION_LABEL, fmtTime } from "../lib/format";
import { Button, Modal, Notice, PageHeader, Panel, Stat, Toggle, cx } from "../components/ui";
import { BarChart, LineChart, Meter } from "../components/Charts";

interface Setup {
  school_location: boolean; desk_phone: boolean; buses: number; crew: number; crew_without_pin: number; students: number;
  students_with_home: number; students_assigned: number; routes: number; cards_unprinted: number; guardians: number;
  guardians_connected: number; buses_paired: number; staff_alerts: boolean; track_base_url: boolean;
}
interface TrendRow { day: string; trips: number; completed: number; on_time_pct: number | null; riders: number; missed: number; exceptions: number; messages: number }

function greeting() {
  const h = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const { org, member } = useAuth();
  const setup = useQuery({ queryKey: ["setup-status"], queryFn: () => rpc<Setup>("setup_status"), refetchInterval: 60_000 });
  const board = useQuery({ queryKey: ["live-board"], queryFn: () => rpc<LB>("live_board"), refetchInterval: 15_000 });
  const trends = useQuery({ queryKey: ["school-trends"], queryFn: () => rpc<TrendRow[]>("school_trends", { p_days: 14 }) });
  const k = board.data?.kpi;
  const first = (member?.name || "").split(" ")[0];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}
        title={`${greeting()}${first ? `, ${first}` : ""}`} sub={`Here's how ${org?.name} buses are doing today.`}
        actions={<Link to="/live"><Button variant="primary"><Radar size={16} /> Open live map</Button></Link>} />

      {k && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat icon={Bus} label="Trips running" value={k.active_trips} hint={`${k.scheduled_trips} still to start`} tone="route" to="/live" />
          <Stat icon={Users} label="Children on buses" value={k.on_board} tone="bus" to="/live" />
          <Stat icon={AlertTriangle} label="Missed / unconfirmed" value={k.not_boarded} tone={k.not_boarded ? "alert" : "ink"} to="/exceptions" />
          <Stat icon={Siren} label="Open alerts" value={k.open_exceptions + k.open_incidents} tone={k.open_exceptions + k.open_incidents ? "alert" : "ink"} to="/exceptions" />
          <Stat icon={CalendarClock} label="Late to start" value={k.late_trips} tone={k.late_trips ? "warn" : "ink"} to="/trips" />
          <Stat icon={WifiOff} label="Bus phones offline" value={k.offline_buses} tone={k.offline_buses ? "warn" : "ink"} to="/buses" />
        </div>
      )}

      {setup.data && <SetupChecklist s={setup.data} />}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <TrendsPanel rows={trends.data ?? []} />
          <AttentionPanel />
        </div>
        <AutomationPanel />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ setup steps */
function SetupChecklist({ s }: { s: Setup }) {
  const { canWrite } = useAuth();
  const qc = useQueryClient();
  const settings = useSettings();
  const [pins, setPins] = useState<{ name: string; role: string; pin: string; bus: string | null }[] | null>(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem("unway-setup-hidden") === "1"; } catch { return false; } });

  async function genPins() {
    try { setPins(await rpc("auto_crew_pins")); qc.invalidateQueries({ queryKey: ["setup-status"] }); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function inviteAll() {
    try { const n = await rpc<number>("invite_all_whatsapp"); toast.success(n ? `WhatsApp invites sent to ${n} parents` : "Everyone with a phone number is already invited"); qc.invalidateQueries({ queryKey: ["setup-status"] }); }
    catch (e) { toast.error((e as Error).message); }
  }

  const steps: { done: boolean; title: string; detail: string; to: string; icon: ComponentType<{ size?: number }>; action?: ReactNode }[] = [
    { done: s.school_location && s.desk_phone, icon: School, title: "School location and desk phone", detail: s.desk_phone ? "Done" : "Parents see the desk phone in every alert.", to: "/settings" },
    { done: s.buses > 0, icon: Bus, title: "Add your buses", detail: s.buses ? `${s.buses} buses` : "Bus number, registration and seats.", to: "/buses" },
    { done: s.crew > 0 && s.crew_without_pin === 0, icon: KeyRound, title: "Drivers, attendants and their PINs",
      detail: s.crew === 0 ? "Crew sign in on the bus phone with a PIN." : s.crew_without_pin ? `${s.crew_without_pin} crew have no PIN yet.` : `${s.crew} crew ready`, to: "/buses",
      action: canWrite && s.crew_without_pin > 0 ? <Button size="sm" variant="bus" onClick={genPins}><Sparkles size={14} /> Generate PINs</Button> : undefined },
    { done: s.students > 0, icon: Users, title: "Import students and parents", detail: s.students ? `${s.students} students` : "Upload your Excel or CSV sheet. Parents are created automatically.", to: "/students/import" },
    { done: s.students > 0 && s.students_assigned >= s.students, icon: RouteIcon, title: "Routes and stops",
      detail: s.students === 0 ? "UnWay can plan routes from home addresses." : `${s.students_assigned} of ${s.students} students on a route · ${s.students_with_home} with a home location`, to: "/routes/plan",
      action: canWrite && s.students > 0 && s.students_assigned < s.students ? <Link to="/routes/plan"><Button size="sm" variant="bus"><Sparkles size={14} /> Auto-plan</Button></Link> : undefined },
    { done: s.buses > 0 && s.buses_paired >= s.buses, icon: Smartphone, title: "Pair a phone on every bus", detail: `${s.buses_paired} of ${s.buses} buses paired`, to: "/buses" },
    { done: s.students > 0 && s.cards_unprinted === 0, icon: MapPinned, title: "Print QR cards", detail: s.cards_unprinted ? `${s.cards_unprinted} cards not printed yet` : "All printed", to: "/cards?unprinted=1" },
    { done: s.guardians > 0 && s.guardians_connected / Math.max(1, s.guardians) >= 0.8, icon: MessageSquareText, title: "Connect parents",
      detail: `${s.guardians_connected} of ${s.guardians} parents get updates`, to: "/parents",
      action: canWrite && settings.channels.whatsapp && s.guardians_connected < s.guardians ? <Button size="sm" variant="bus" onClick={inviteAll}>Invite all on WhatsApp</Button> : undefined },
    { done: s.staff_alerts, icon: BellRing, title: "SOS alerts on staff phones", detail: s.staff_alerts ? "Connected" : "Link a staff Telegram chat or group.", to: "/settings" },
  ];
  const done = steps.filter((x) => x.done).length;
  if (done === steps.length || hidden) {
    return done === steps.length ? null : (
      <button className="text-sm font-semibold text-route" onClick={() => { setHidden(false); try { localStorage.removeItem("unway-setup-hidden"); } catch { /* */ } }}>
        Show setup checklist ({done}/{steps.length})
      </button>
    );
  }
  return (
    <Panel title={<span className="flex items-center gap-2"><Sparkles size={18} className="text-bus-deep" /> Get set up</span>}
      actions={<><div className="w-40"><Meter value={done} max={steps.length} tone="safe" /></div><span className="text-sm font-semibold tabular">{done}/{steps.length}</span>
        <Button size="sm" variant="ghost" onClick={() => { setHidden(true); try { localStorage.setItem("unway-setup-hidden", "1"); } catch { /* */ } }}>Hide</Button></>} padded={false}>
      <ol className="grid divide-y divide-line-2 md:grid-cols-2 md:divide-y-0">
        {steps.map((st, i) => (
          <li key={i} className={cx("flex items-center gap-3 px-5 py-3 md:border-b md:border-line-2", i % 2 === 0 && "md:border-r")}>
            <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full", st.done ? "bg-safe text-white" : "bg-surface text-ink-3")}>
              {st.done ? <Check size={16} /> : <st.icon size={16} />}
            </span>
            <Link to={st.to} className="min-w-0 flex-1">
              <div className={cx("font-semibold", st.done && "text-ink-3 line-through decoration-ink-3/40")}>{st.title}</div>
              <div className="truncate text-sm text-ink-3">{st.detail}</div>
            </Link>
            {!st.done && (st.action ?? <Link to={st.to} className="text-ink-3 hover:text-ink" aria-label={st.title}><ArrowRight size={18} /></Link>)}
          </li>
        ))}
      </ol>
      <Modal open={!!pins} onClose={() => setPins(null)} title="New crew PINs"
        footer={<><Button onClick={() => window.print()}>Print</Button><Button variant="primary" onClick={() => setPins(null)}>Done</Button></>}>
        <p className="mb-3 text-sm text-ink-2">Share each PIN privately with that person. PINs are stored scrambled, so this is the only time you'll see them. You can set a new PIN any time in Buses &amp; crew.</p>
        <ul className="divide-y divide-line-2">
          {(pins ?? []).map((p, i) => (
            <li key={i} className="flex items-center justify-between py-2">
              <span><b>{p.name}</b> <span className="text-sm text-ink-3">{p.role}{p.bus ? ` · Bus ${p.bus}` : ""}</span></span>
              <span className="rounded-md bg-bus-soft px-2.5 py-0.5 text-lg font-extrabold tracking-widest tabular">{p.pin}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </Panel>
  );
}

/* ------------------------------------------------------------------ trends */
function TrendsPanel({ rows }: { rows: TrendRow[] }) {
  const [view, setView] = useState<"riders" | "ontime" | "messages">("riders");
  const label = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const totalRiders = rows.reduce((a, r) => a + r.riders, 0);
  const totalMsgs = rows.reduce((a, r) => a + r.messages, 0);
  const ot = rows.filter((r) => r.on_time_pct != null);
  const avgOnTime = ot.length ? Math.round(ot.reduce((a, r) => a + Number(r.on_time_pct), 0) / ot.length) : null;
  const tab = (v: typeof view, title: string, value: ReactNode) => (
    <button onClick={() => setView(v)} className={cx("flex-1 rounded-2xl px-4 py-3 text-left transition-all duration-300", view === v ? "bg-ink text-white shadow-[var(--shadow-soft)]" : "neu-soft neu-press")}>
      <div className="text-xl font-extrabold tabular">{value}</div><div className={cx("text-xs font-semibold", view === v ? "text-white/70" : "text-ink-3")}>{title}</div>
    </button>
  );
  return (
    <Panel title="Last 14 days">
      <div className="mb-4 flex flex-wrap gap-2">
        {tab("riders", "Children carried", totalRiders)}
        {tab("ontime", "Trips started on time", avgOnTime == null ? "–" : `${avgOnTime}%`)}
        {tab("messages", "Parent messages sent", totalMsgs)}
      </div>
      {rows.length === 0 ? <p className="py-10 text-center text-ink-3">No trips yet.</p>
        : view === "riders" ? <BarChart data={rows.map((r) => ({ label: label(r.day), value: r.riders, detail: r.missed ? `${r.missed} missed` : undefined }))} fmt={(v) => `${v} rides`} />
        : view === "ontime" ? <LineChart data={rows.map((r) => ({ label: label(r.day), value: r.on_time_pct == null ? null : Number(r.on_time_pct), detail: `${r.completed}/${r.trips} trips completed` }))} maxValue={100} unit="%" fmt={(v) => `${v}% on time`} />
        : <BarChart data={rows.map((r) => ({ label: label(r.day), value: r.messages }))} color="#1F8A5B" fmt={(v) => `${v} messages`} />}
    </Panel>
  );
}

function AttentionPanel() {
  const ex = useQuery({
    queryKey: ["home-exceptions"], refetchInterval: 20_000,
    queryFn: async () => (await supabase.from("exceptions").select("*").neq("status", "resolved").order("opened_at", { ascending: false }).limit(6)).data as ExceptionRow[],
  });
  return (
    <Panel title="Needs attention" actions={<Link to="/exceptions" className="text-sm font-semibold text-route">All alerts</Link>} padded={false}>
      {ex.data?.length ? (
        <ul className="divide-y divide-line-2">
          {ex.data.map((x) => (
            <li key={x.id} className="flex items-start gap-3 px-5 py-3">
              <span className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", x.severity === "critical" || x.severity === "high" ? "bg-alert" : "bg-warn")} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{EXCEPTION_LABEL[x.code] ?? x.code}</div>
                <div className="text-sm text-ink-2">{x.message}</div>
              </div>
              <span className="whitespace-nowrap text-sm text-ink-3">{fmtTime(x.opened_at)}</span>
            </li>
          ))}
        </ul>
      ) : <div className="flex items-center gap-3 px-5 py-6 text-ink-3"><Check className="text-safe" size={20} /> Nothing needs attention right now.</div>}
    </Panel>
  );
}

/* ------------------------------------------------------------- automation */
function AutomationPanel() {
  const { org, isAdmin, refresh } = useAuth();
  const s = useSettings();
  async function save(patch: Record<string, unknown>) {
    const { error } = await supabase.from("organizations").update({ settings: { ...(org!.settings ?? {}), ...patch } }).eq("id", org!.id);
    if (error) toast.error(friendlyError(error.message)); else { toast.success("Saved"); await refresh(); }
  }
  const items: { icon: ComponentType<{ size?: number }>; title: string; detail: string; on?: boolean; key?: string }[] = [
    { icon: CalendarClock, title: "Trips created every night", detail: "Tomorrow's trips and passenger lists are ready by midnight, skipping holidays.", on: true },
    { icon: MessageSquareText, title: "Parent alerts on every scan", detail: "Boarded, reached school, dropped home: sent the moment the card is scanned.", on: true },
    { icon: Gauge, title: "\"Bus is 5 minutes away\"", detail: `Parents at the next stops get a heads-up when the bus is about ${(s.approaching_m / 1000).toFixed(1)} km away.`, on: s.approaching_alert, key: "approaching_alert" },
    { icon: AlertTriangle, title: "Missed-boarding and drop alerts", detail: "If a child isn't scanned at their stop, parents and staff hear about it straight away.", on: true },
    { icon: TimerReset, title: "Escalate unhandled alerts", detail: `Serious alerts nobody acts on for ${s.escalate_after_min} min go to staff phones again. SOS after 3 min.`, on: true },
    { icon: Moon, title: "Evening summary at 6 pm", detail: "Staff get one message with today's trips, safe rides, misses and open alerts.", on: s.evening_summary, key: "evening_summary" },
    { icon: RouteIcon, title: "Stop times learn from real trips", detail: "Planned times adjust every night to how long the bus really takes.", on: s.learn_stop_times, key: "learn_stop_times" },
    { icon: Smartphone, title: "Invite new parents on WhatsApp", detail: s.channels.whatsapp ? "New parents get a WhatsApp invite automatically." : "Turn on WhatsApp in Settings to use this.", on: s.channels.whatsapp && s.auto_whatsapp_invite, key: s.channels.whatsapp ? "auto_whatsapp_invite" : undefined },
  ];
  return (
    <Panel title={<span className="flex items-center gap-2"><Sparkles size={18} className="text-bus-deep" /> Working for you automatically</span>} padded={false}>
      <ul className="divide-y divide-line-2">
        {items.map((it) => (
          <li key={it.title} className="flex items-start gap-3 px-5 py-3">
            <span className={cx("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", it.on ? "bg-safe-soft text-safe" : "bg-surface text-ink-3")}>
              {it.on ? <it.icon size={16} /> : <CircleDashed size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{it.title}</div>
              <div className="text-sm text-ink-3">{it.detail}</div>
            </div>
            {it.key ? <Toggle label={it.title} checked={!!it.on} disabled={!isAdmin} onChange={(v) => save({ [it.key!]: v })} />
              : <span className="mt-1 text-xs font-semibold text-safe">Always on</span>}
          </li>
        ))}
      </ul>
      <div className="border-t border-line-2 px-5 py-3"><Notice tone="bus" title="Fine-tune timings" action={<Link to="/settings"><Button size="sm">Settings</Button></Link>}>Distances, escalation minutes and alert channels.</Notice></div>
    </Panel>
  );
}
