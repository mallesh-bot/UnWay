import { useEffect, useRef, useState, type PointerEvent } from "react";
import { AnimatePresence, motion, useAnimationFrame, useMotionValue, useMotionValueEvent, useReducedMotion, useSpring, useTransform } from "motion/react";

// A school morning, looped: the bus drives the route, every stop lights up as children board,
// and the parent's phone gets the same messages UnWay really sends.

const ROUTE = "M 60 430 C 120 430 130 350 190 340 S 300 380 330 300 S 300 170 380 150 S 520 190 540 110 S 520 50 470 48";
const STOPS = [
  { at: 0.13, name: "Sai Nagar", kid: "Aarav", time: "7:23" },
  { at: 0.34, name: "Lake View", kid: "Diya", time: "7:31" },
  { at: 0.55, name: "Temple Road", kid: "Kabir", time: "7:38" },
  { at: 0.77, name: "Green Park", kid: "Meera", time: "7:46" },
];
const SCHOOL_AT = 0.985;
const LOOP_MS = 16000;

type Note = { id: string; tone: "go" | "soon" | "school"; title: string; body: string };

export default function HeroRoute() {
  const path = useRef<SVGPathElement>(null);
  const reduce = useReducedMotion();
  const [len, setLen] = useState(0);
  const t = useMotionValue(reduce ? 0.6 : 0);
  const [passed, setPassed] = useState(-1);
  const [notes, setNotes] = useState<Note[]>([]);
  const last = useRef({ passed: -1, soon: -1, school: false });

  useEffect(() => { if (path.current) setLen(path.current.getTotalLength()); }, []);

  useAnimationFrame((time) => {
    if (reduce || !len) return;
    const p = (time % LOOP_MS) / LOOP_MS;
    t.set(Math.min(p / 0.92, 1)); // drive for 92% of the loop, then wait at school
    const v = t.get();
    const idx = STOPS.reduce((a, s, i) => (v >= s.at ? i : a), -1);
    if (idx < last.current.passed) { last.current = { passed: -1, soon: -1, school: false }; setPassed(-1); setNotes([]); }
    if (idx > last.current.passed) {
      last.current.passed = idx; setPassed(idx);
      const s = STOPS[idx];
      push({ id: `b${idx}`, tone: "go", title: `${s.kid} boarded Bus 7`, body: `${s.name} · ${s.time} am` });
    }
    const soonIdx = STOPS.findIndex((s) => v > s.at - 0.07 && v < s.at - 0.02);
    if (soonIdx >= 0 && soonIdx > last.current.soon) {
      last.current.soon = soonIdx;
      push({ id: `s${soonIdx}`, tone: "soon", title: "Bus 7 is about 5 min away", body: `Get ${STOPS[soonIdx].kid} ready at ${STOPS[soonIdx].name}` });
    }
    if (v >= SCHOOL_AT && !last.current.school) {
      last.current.school = true;
      push({ id: "school", tone: "school", title: "Reached school safely", body: "All 4 children checked off · 8:02 am" });
    }
  });

  function push(n: Note) { setNotes((x) => [n, ...x.filter((y) => y.id !== n.id)].slice(0, 3)); }

  const bus = useRef<SVGGElement>(null);
  useMotionValueEvent(t, "change", (v) => {
    if (!path.current || !len || !bus.current) return;
    const p = path.current.getPointAtLength(v * len);
    const q = path.current.getPointAtLength(Math.min(len, v * len + 2));
    const a = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    bus.current.setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${a})`);
  });
  useEffect(() => { if (len) { const v = t.get(); t.set(v + 1e-6); t.set(v); } }, [len, t]);
  const trail = useTransform(t, (v) => len * (1 - v));

  // gentle 3D tilt towards the pointer
  const rx = useSpring(0, { stiffness: 80, damping: 18 });
  const ry = useSpring(0, { stiffness: 80, damping: 18 });
  function onMove(e: PointerEvent) {
    if (reduce) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 10);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 8);
  }

  return (
    <div className="relative [perspective:1400px]" onPointerMove={onMove} onPointerLeave={() => { rx.set(0); ry.set(0); }}>
      <motion.div style={{ rotateX: rx, rotateY: ry }} className="relative rounded-[40px] bg-panel p-4 shadow-[var(--shadow-pop)] sm:p-6">
        <div className="rounded-[30px] bg-surface p-2 shadow-[inset_6px_6px_14px_var(--neu-dark),inset_-6px_-6px_14px_var(--neu-light)]">
          <svg viewBox="0 0 600 480" className="block h-auto w-full" role="img" aria-label="Bus 7 driving its morning route, picking up four children and reaching school">
            {/* soft city blocks */}
            {[[40, 40, 120, 90], [200, 30, 110, 70], [70, 190, 90, 80], [410, 260, 140, 90], [230, 400, 130, 60], [440, 380, 120, 70]].map(([x, y, w, h], i) => (
              <rect key={i} x={x} y={y} width={w} height={h} rx="18" fill="var(--color-panel)" style={{ filter: "drop-shadow(4px 4px 6px rgba(150,165,190,.45)) drop-shadow(-4px -4px 6px rgba(255,255,255,.9))" }} />
            ))}
            {/* road */}
            <path d={ROUTE} fill="none" stroke="#cdd5e0" strokeWidth="30" strokeLinecap="round" />
            <path d={ROUTE} fill="none" stroke="#dfe5ed" strokeWidth="24" strokeLinecap="round" />
            <path d={ROUTE} fill="none" stroke="#c3ccd8" strokeWidth="2" strokeDasharray="10 12" strokeLinecap="round" />
            {/* driven part of the route */}
            <motion.path ref={path} d={ROUTE} fill="none" stroke="var(--color-bus)" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={len || 1} style={{ strokeDashoffset: trail }} />

            {/* school */}
            <g transform="translate(470 48)">
              <circle r="30" fill="var(--color-ink)" />
              <path d="M -13 6 V -4 L 0 -13 L 13 -4 V 6 Z" fill="var(--color-bus)" />
              <rect x="-4" y="-2" width="8" height="8" fill="var(--color-ink)" />
            </g>

            {/* stops */}
            {STOPS.map((s, i) => {
              const p = path.current && len ? path.current.getPointAtLength(s.at * len) : null;
              if (!p) return null;
              const done = i <= passed;
              return (
                <g key={s.name} transform={`translate(${p.x} ${p.y})`}>
                  <motion.circle r="17" animate={{ fill: done ? "#17905f" : "#ebeff5", scale: done ? [1, 1.35, 1] : 1 }} transition={{ duration: 0.6 }}
                    stroke={done ? "#17905f" : "#3566cc"} strokeWidth="4" />
                  {done && <motion.path d="M -6 0 L -2 5 L 7 -5" stroke="white" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4 }} />}
                  <text y="-28" textAnchor="middle" fontSize="15" fontWeight="700" fill="#3c4a5b" fontFamily="Figtree">{s.name}</text>
                </g>
              );
            })}

            {/* the bus */}
            <g ref={bus} transform="translate(60 430)">
              <ellipse rx="34" ry="20" fill="rgba(31,42,55,.18)" transform="translate(3 5)" />
              <rect x="-30" y="-15" width="60" height="30" rx="8" fill="var(--color-bus)" stroke="var(--color-ink)" strokeWidth="3" />
              <rect x="14" y="-11" width="11" height="22" rx="3" fill="var(--color-ink)" opacity=".85" />
              {[-22, -10, 2].map((x) => <rect key={x} x={x} y="-11" width="9" height="6" rx="2" fill="var(--color-ink)" opacity=".7" />)}
              {[-22, -10, 2].map((x) => <rect key={x} x={x} y="5" width="9" height="6" rx="2" fill="var(--color-ink)" opacity=".7" />)}
            </g>
          </svg>
        </div>
      </motion.div>

      {/* parent's phone */}
      <div className="absolute -bottom-10 right-2 w-[min(270px,62%)] sm:-right-6 lg:-right-10">
        <div className="rounded-[34px] bg-ink p-2.5 shadow-[18px_18px_40px_rgba(31,42,55,.35),-10px_-10px_30px_rgba(255,255,255,.7)]">
          <div className="min-h-[218px] rounded-[26px] bg-surface px-3 pb-3 pt-2.5">
            <div className="mx-auto mb-2.5 h-1.5 w-14 rounded-full bg-ink/15" />
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-ink-3"><span>Parent's phone</span><span>now</span></div>
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {notes.map((n) => (
                  <motion.div key={n.id} layout initial={{ opacity: 0, y: -24, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 380, damping: 28 }}
                    className="flex gap-2.5 rounded-2xl bg-panel p-2.5 shadow-[4px_4px_10px_var(--neu-dark),-4px_-4px_10px_var(--neu-light)]">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm ${n.tone === "go" ? "bg-safe text-white" : n.tone === "soon" ? "bg-bus text-ink" : "bg-ink text-bus"}`}>
                      {n.tone === "go" ? "✓" : n.tone === "soon" ? "⏱" : "🏫"}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-[13px] font-bold">{n.title}</span>
                      <span className="block truncate text-[12px] text-ink-3">{n.body}</span>
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {notes.length === 0 && <p className="pt-6 text-center text-xs text-ink-3">Waiting for Bus 7…</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
