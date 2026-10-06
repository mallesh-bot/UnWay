import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { BellRing, Building2, CalendarClock, Clock3, Moon, Route as RouteIcon, School, Siren, Users } from "lucide-react";

/* ------------------------------------------------------------------ three dashboards */
const BOARDS = [
  { key: "school", label: "Schools", icon: School, title: "The school dashboard", text: "Every bus on one live map, who's on board right now, and the few things that need a person. Routes plan themselves from home addresses." },
  { key: "parents", label: "Parents", icon: Users, title: "A page for every parent", text: "Opened from the link the school sends. No password, no app: today's status, the bus stop and time, planned absences and the last 30 days." },
  { key: "team", label: "UnWay team", icon: Building2, title: "Your console for every school", text: "Add schools, invite their admins, see which parents are connected, catch failed messages and peek into any school read-only." },
] as const;
type BoardKey = (typeof BOARDS)[number]["key"];

export function Dashboards() {
  const [active, setActive] = useState<BoardKey>("school");
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setActive((a) => BOARDS[(BOARDS.findIndex((b) => b.key === a) + 1) % BOARDS.length].key), 5200);
    return () => clearInterval(id);
  }, [auto]);
  const b = BOARDS.find((x) => x.key === active)!;

  return (
    <section id="dashboards" className="mx-auto max-w-6xl px-5 py-28">
      <h2 className="max-w-[18ch] font-display text-[clamp(34px,5vw,60px)] font-extrabold leading-[1.02] tracking-tight">Three dashboards, one calm morning.</h2>
      <div className="mt-8 inline-flex rounded-[22px] bg-surface p-2 shadow-[var(--shadow-inset)]" role="tablist">
        {BOARDS.map((x) => (
          <button key={x.key} role="tab" aria-selected={active === x.key} onClick={() => { setActive(x.key); setAuto(false); }}
            className={`relative flex items-center gap-2 rounded-2xl px-4 py-2.5 font-semibold transition-colors sm:px-5 ${active === x.key ? "text-ink" : "text-ink-3 hover:text-ink"}`}>
            {active === x.key && <motion.span layoutId="board-pill" className="absolute inset-0 rounded-2xl bg-panel shadow-[var(--shadow-soft)]" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
            <x.icon size={17} className="relative" /><span className="relative">{x.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-10 grid items-center gap-10 lg:grid-cols-[1fr_1.35fr]">
        <AnimatePresence mode="wait">
          <motion.div key={b.key} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <h3 className="font-display text-3xl font-bold">{b.title}</h3>
            <p className="mt-3 max-w-[44ch] text-lg text-ink-2">{b.text}</p>
          </motion.div>
        </AnimatePresence>
        <div className="relative min-h-[380px] rounded-[36px] bg-panel p-5 shadow-[var(--shadow-pop)]">
          <AnimatePresence mode="wait">
            <motion.div key={b.key} initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
              {active === "school" ? <SchoolMock /> : active === "parents" ? <ParentMock /> : <TeamMock />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

const tile = "rounded-2xl bg-panel p-4 shadow-[var(--shadow-soft)]";
function SchoolMock() {
  const buses = [{ n: "3", on: 28, done: 6, miss: 0 }, { n: "7", on: 18, done: 14, miss: 1 }, { n: "12", on: 31, done: 0, miss: 0 }];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[["9", "buses running"], ["77", "children on buses"], ["1", "needs a call"]].map(([v, l], i) => (
          <div key={l} className={tile}><div className={`font-display text-3xl font-extrabold ${i === 2 ? "text-alert" : ""}`}>{v}</div><div className="text-xs text-ink-3">{l}</div></div>
        ))}
      </div>
      {buses.map((x, i) => (
        <div key={x.n} className={`${tile} flex items-center gap-4`}>
          <span className="plate">{x.n}</span>
          <div className="flex-1">
            <div className="flex h-3 overflow-hidden rounded-full bg-surface shadow-[inset_2px_2px_4px_var(--neu-dark),inset_-2px_-2px_4px_var(--neu-light)]">
              <motion.div className="bg-safe" initial={{ width: 0 }} animate={{ width: `${(x.done / 40) * 100}%` }} transition={{ delay: 0.2 + i * 0.1, duration: 0.8 }} />
              <motion.div className="bg-route" initial={{ width: 0 }} animate={{ width: `${(x.on / 40) * 100}%` }} transition={{ delay: 0.3 + i * 0.1, duration: 0.8 }} />
              {x.miss > 0 && <motion.div className="bg-alert" initial={{ width: 0 }} animate={{ width: "4%" }} transition={{ delay: 0.6, duration: 0.5 }} />}
            </div>
            <div className="mt-1.5 text-xs text-ink-3">{x.on} on bus · {x.done} dropped{x.miss ? " · 1 missed" : ""}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
function ParentMock() {
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <div className="rounded-[26px] bg-route p-5 text-white shadow-[var(--shadow-soft)]">
        <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-white/20 font-display font-bold">AR</span><div><div className="font-display text-xl font-bold">Aarav</div><div className="text-sm text-white/75">Class 3-B · today</div></div></div>
        <div className="mt-4 font-display text-2xl font-extrabold">On the bus</div>
        <div className="mt-1 flex items-center gap-2 text-sm text-white/85"><span className="plate" style={{ height: "1.5rem" }}>7</span> boarded 7:23 am</div>
      </div>
      <div className={tile}>
        <div className="font-semibold">Not taking the bus?</div>
        <div className="mt-3 flex gap-2">{["Today", "Tomorrow", "Other date"].map((d, i) => <span key={d} className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${i === 1 ? "shadow-[inset_2px_2px_5px_var(--neu-dark),inset_-2px_-2px_5px_var(--neu-light)] ring-2 ring-bus" : "bg-panel shadow-[var(--shadow-soft)]"}`}>{d}</span>)}</div>
      </div>
      <div className={`${tile} flex justify-between text-center`}>
        {[["41", "trips"], ["0", "missed"], ["2", "absent"]].map(([v, l]) => <div key={l} className="flex-1"><div className="font-display text-2xl font-extrabold">{v}</div><div className="text-xs text-ink-3">{l}</div></div>)}
      </div>
    </div>
  );
}
function TeamMock() {
  const rows = [["Greenfield High", 92], ["Sunrise Public", 78], ["St. Mary's", 64], ["Delhi Model", 41]] as const;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[["24", "schools"], ["8,940", "students"], ["87%", "parents connected"]].map(([v, l]) => <div key={l} className={tile}><div className="font-display text-3xl font-extrabold">{v}</div><div className="text-xs text-ink-3">{l}</div></div>)}
      </div>
      <div className={tile}>
        {rows.map(([n, p], i) => (
          <div key={n} className="flex items-center gap-3 py-2">
            <span className="w-32 truncate text-sm font-semibold">{n}</span>
            <div className="h-2.5 flex-1 rounded-full bg-surface shadow-[inset_2px_2px_4px_var(--neu-dark),inset_-2px_-2px_4px_var(--neu-light)]">
              <motion.div className="h-full rounded-full bg-safe" initial={{ width: 0 }} animate={{ width: `${p}%` }} transition={{ delay: 0.15 + i * 0.1, duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            <span className="w-10 text-right text-sm tabular text-ink-3">{p}%</span>
          </div>
        ))}
      </div>
      <div className={`${tile} flex h-24 items-end gap-1.5`}>
        {[30, 42, 38, 55, 61, 58, 70, 66, 74, 81, 77, 88, 92, 96].map((h, i) => (
          <motion.div key={i} className="flex-1 rounded-t-md bg-route" initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: i * 0.035, duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ automation clock */
const AUTOS = [
  { h: 0, at: "12:00 am", icon: CalendarClock, title: "Tomorrow is ready", text: "Trips and passenger lists are created for every bus, skipping holidays." },
  { h: 0.1, at: "12:05 am", icon: RouteIcon, title: "Stop times learn", text: "Planned times adjust to how long each bus really took this week." },
  { h: 6.75, at: "6:45 am", icon: Clock3, title: "Late buses flagged", text: "Every minute, buses that haven't started and phones that went quiet are flagged." },
  { h: 7.35, at: "7:21 am", icon: BellRing, title: "\"Bus is 5 minutes away\"", text: "Parents at the next stop get a heads-up while the bus drives." },
  { h: 7.6, at: "7:36 am", icon: Siren, title: "Nobody ignores an alert", text: "Anything serious that sits unhandled for 5 minutes goes to staff phones again." },
  { h: 18, at: "6:00 pm", icon: Moon, title: "The day, in one message", text: "Staff get trips, safe drops, misses and open alerts in one evening summary." },
];

export function AutomationClock() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 40%"] });
  const p = useSpring(scrollYProgress, { stiffness: 70, damping: 20 });
  const hours = useTransform(p, [0, 1], [0, 19]);
  const angle = useTransform(hours, (h) => (h / 24) * 360);
  const minute = useTransform(angle, (a) => a * 12);
  const [active, setActive] = useState(0);
  useMotionValueEvent(hours, "change", (h) => setActive(AUTOS.reduce((a, x, i) => (h >= x.h ? i : a), 0)));
  const clockLabel = useTransform(hours, (h) => {
    const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
    return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
  });

  return (
    <section id="automation" ref={ref} className="mx-auto max-w-6xl px-5 py-28">
      <h2 className="max-w-[20ch] font-display text-[clamp(34px,5vw,60px)] font-extrabold leading-[1.02] tracking-tight">The busywork runs itself, all day.</h2>
      <p className="mt-4 max-w-[52ch] text-lg text-ink-2">Scroll and watch a school day go by. Each of these used to be a phone call, a register or a WhatsApp group.</p>
      <div className="mt-14 grid items-center gap-14 lg:grid-cols-[minmax(300px,440px)_1fr]">
        <div className="relative mx-auto aspect-square w-full max-w-[440px] rounded-full bg-panel shadow-[var(--shadow-pop)]">
          <div className="absolute inset-[9%] rounded-full bg-surface shadow-[inset_10px_10px_22px_var(--neu-dark),inset_-10px_-10px_22px_var(--neu-light)]" />
          <svg viewBox="0 0 200 200" className="absolute inset-0" aria-hidden>
            {Array.from({ length: 24 }).map((_, i) => {
              const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
              return <line key={i} x1={100 + Math.cos(a) * 74} y1={100 + Math.sin(a) * 74} x2={100 + Math.cos(a) * (i % 6 === 0 ? 66 : 70)} y2={100 + Math.sin(a) * (i % 6 === 0 ? 66 : 70)}
                stroke="#9aa6b6" strokeWidth={i % 6 === 0 ? 2 : 1} strokeLinecap="round" />;
            })}
            {AUTOS.map((x, i) => {
              const a = (x.h / 24) * Math.PI * 2 - Math.PI / 2;
              return <circle key={i} cx={100 + Math.cos(a) * 83} cy={100 + Math.sin(a) * 83} r={i <= active ? 4.5 : 3.5} fill={i <= active ? "#f6b800" : "#c3ccd8"} stroke="#1f2a37" strokeWidth={i === active ? 1.5 : 0} style={{ transition: "all .4s" }} />;
            })}
          </svg>
          <motion.div className="absolute left-1/2 top-1/2 h-[36%] w-2 origin-bottom -translate-x-1/2 -translate-y-full rounded-full bg-ink" style={{ rotate: angle }} />
          <motion.div className="absolute left-1/2 top-1/2 h-[28%] w-3 origin-bottom -translate-x-1/2 -translate-y-full rounded-full bg-bus/90" style={{ rotate: minute }} />
          <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow-[var(--shadow-soft)]" />
          <motion.div className="absolute bottom-[22%] left-1/2 -translate-x-1/2 rounded-full bg-panel px-4 py-1.5 font-display text-lg font-bold tabular shadow-[var(--shadow-soft)]">{clockLabel}</motion.div>
        </div>
        <ol className="space-y-3">
          {AUTOS.map((x, i) => (
            <li key={x.title} className={`flex gap-4 rounded-[24px] p-4 transition-all duration-500 ${i === active ? "bg-panel shadow-[var(--shadow-card)]" : "opacity-55"}`}>
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition-colors duration-500 ${i <= active ? "bg-bus text-ink" : "bg-surface text-ink-3 shadow-[var(--shadow-inset)]"}`}><x.icon size={20} /></span>
              <div>
                <div className="text-sm font-semibold text-ink-3 tabular">{x.at}</div>
                <div className="font-display text-lg font-bold">{x.title}</div>
                <p className="text-ink-2">{x.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
