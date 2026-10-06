import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";

// "One morning, start to finish": a sticky scene where scrolling advances the trip.

const STEPS = [
  { time: "6:58", title: "The crew signs in", text: "The attendant picks today's crew on the bus phone and enters a PIN. The full passenger list, with photos, downloads so scanning works even without network." },
  { time: "7:21", title: "Parents get a heads-up", text: "When the bus is about five minutes from a stop, parents waiting there get a message. Nobody stands on the road guessing." },
  { time: "7:23", title: "One scan, one message", text: "The child shows their card. The phone flashes green with their photo, and their parent hears about it seconds later on Telegram, WhatsApp or the browser." },
  { time: "7:31", title: "Missing? Everyone knows now", text: "If the bus leaves a stop without a child it expected, the phone asks why. If nobody answers, the parent and the school are alerted straight away." },
  { time: "8:02", title: "Nobody left behind", text: "At school the trip can't close until every child has a status and the attendant confirms the Empty Bus Check with their PIN." },
];

export default function Story() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.4 });
  const [step, setStep] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setStep(Math.min(STEPS.length - 1, Math.floor(v * STEPS.length * 0.999))));
  const busY = useTransform(smooth, [0, 1], ["0%", "100%"]);
  const fill = useTransform(smooth, [0, 1], ["0%", "100%"]);

  return (
    <section id="how" ref={ref} className="relative" style={{ height: `${STEPS.length * 85 + 40}vh` }}>
      <div className="sticky top-0 flex h-screen items-center overflow-hidden pt-20 md:pt-0">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-4 px-5 md:grid-cols-[auto_1fr_auto] md:gap-14">
          {/* the trip rail */}
          <div className="relative hidden h-[60vh] w-14 md:block" aria-hidden>
            <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 rounded-full bg-surface shadow-[inset_3px_3px_6px_var(--neu-dark),inset_-3px_-3px_6px_var(--neu-light)]" />
            <motion.div className="absolute left-1/2 top-0 w-3 -translate-x-1/2 rounded-full bg-bus" style={{ height: fill }} />
            {STEPS.map((s, i) => (
              <div key={s.time} className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top: `${(i / (STEPS.length - 1)) * 100}%` }}>
                <div className={`h-5 w-5 rounded-full transition-all duration-500 ${i <= step ? "scale-110 bg-ink" : "bg-panel shadow-[var(--shadow-soft)]"}`} />
              </div>
            ))}
            <motion.div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top: busY }}>
              <span className="plate plate-lg">7</span>
            </motion.div>
          </div>

          {/* words */}
          <div className="min-h-[230px] md:min-h-[300px]">
            <p className="mb-2 font-display text-base font-semibold text-ink-3 md:mb-4 md:text-lg">One morning, start to finish</p>
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
                <div className="font-display text-[clamp(48px,9vw,112px)] font-extrabold leading-none tracking-tight text-ink/90 tabular">{STEPS[step].time}</div>
                <h3 className="mt-3 font-display text-[clamp(26px,3.4vw,40px)] font-bold leading-tight">{STEPS[step].title}</h3>
                <p className="mt-2 max-w-[46ch] text-[15px] text-ink-2 md:mt-3 md:text-lg">{STEPS[step].text}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* the bus phone */}
          <div className="mx-auto h-[330px] w-[280px] shrink-0 md:h-auto"><div className="origin-top scale-[0.62] md:scale-100">
            <div className="rounded-[42px] bg-panel p-3 shadow-[var(--shadow-pop)]">
              <div className="relative h-[520px] overflow-hidden rounded-[32px] bg-surface shadow-[inset_5px_5px_12px_var(--neu-dark),inset_-5px_-5px_12px_var(--neu-light)]">
                <AnimatePresence mode="wait">
                  <motion.div key={step} className="absolute inset-0 flex flex-col p-5"
                    initial={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, scale: 1.04, filter: "blur(6px)" }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
                    <Screen step={step} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Screen({ step }: { step: number }) {
  const head = (t: string) => <div className="mb-4 flex items-center justify-between text-xs font-semibold text-ink-3"><span>UnWay Bus · 7</span><span>{t}</span></div>;
  if (step === 0) return (
    <>
      {head("6:58")}
      <p className="font-display text-xl font-bold">Who's on the bus?</p>
      <div className="mt-3 space-y-2">
        {["Ramesh · driver", "Lakshmi · attendant"].map((n) => <div key={n} className="rounded-2xl bg-bus px-4 py-3 font-semibold shadow-[var(--shadow-soft)]">{n}</div>)}
      </div>
      <div className="mt-auto">
        <div className="mb-3 flex justify-center gap-3">{[0, 1, 2, 3].map((i) => <motion.span key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.25 + i * 0.12 }} className="h-4 w-4 rounded-full bg-ink" />)}</div>
        <div className="grid grid-cols-3 gap-2">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <span key={n} className="grid h-11 place-items-center rounded-2xl bg-panel font-display text-lg font-bold shadow-[var(--shadow-soft)]">{n}</span>)}</div>
      </div>
    </>
  );
  if (step === 1) return (
    <>
      {head("7:21")}
      <p className="font-display text-xl font-bold">Next stop</p>
      <p className="text-ink-3">Lake View · 3 children</p>
      <div className="relative mx-auto mt-8 grid h-40 w-40 place-items-center">
        {[0, 1, 2].map((i) => <motion.span key={i} className="absolute inset-0 rounded-full border-4 border-bus" initial={{ scale: 0.4, opacity: 0.9 }} animate={{ scale: 1.25, opacity: 0 }} transition={{ duration: 2, repeat: Infinity, delay: i * 0.6 }} />)}
        <span className="plate plate-lg">7</span>
      </div>
      <div className="mt-auto rounded-2xl bg-panel p-3 shadow-[var(--shadow-soft)]">
        <p className="text-sm font-bold">3 parents told</p>
        <p className="text-xs text-ink-3">"Bus 7 is about 5 min from Lake View"</p>
      </div>
    </>
  );
  if (step === 2) return (
    <motion.div className="-m-5 flex flex-1 flex-col items-center justify-center bg-safe p-5 text-center text-white" initial={{ backgroundColor: "#e7ecf2" }} animate={{ backgroundColor: "#17905f" }} transition={{ duration: 0.4 }}>
      <motion.div initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.15 }}
        className="grid h-28 w-28 place-items-center rounded-full bg-white/20 font-display text-4xl font-extrabold">DS</motion.div>
      <p className="mt-5 font-display text-3xl font-extrabold">Diya Sharma</p>
      <p className="text-white/85">Class 5-A · boarded</p>
      <p className="mt-6 rounded-full bg-white/20 px-4 py-1.5 text-sm font-semibold">Mom notified · 2 s</p>
    </motion.div>
  );
  if (step === 3) return (
    <>
      {head("7:31")}
      <div className="rounded-3xl bg-alert p-4 text-white shadow-[var(--shadow-soft)]">
        <p className="font-display text-xl font-bold">Leaving Temple Road</p>
        <p className="text-white/85">Kabir hasn't boarded</p>
      </div>
      <div className="mt-4 space-y-2">
        {["Absent today", "Parent dropping him", "Not at the stop"].map((o, i) => (
          <motion.div key={o} initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.2 + i * 0.1 }}
            className="rounded-2xl bg-panel px-4 py-3 font-semibold shadow-[var(--shadow-soft)]">{o}</motion.div>
        ))}
      </div>
      <p className="mt-auto text-center text-xs text-ink-3">No answer in time? The school and parent are alerted.</p>
    </>
  );
  return (
    <>
      {head("8:02")}
      <p className="font-display text-xl font-bold">Empty Bus Check</p>
      <div className="mt-4 space-y-2.5">
        {["Walked to the last row", "Checked under seats", "All 32 children off"].map((o, i) => (
          <motion.div key={o} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + i * 0.25 }} className="flex items-center gap-3 rounded-2xl bg-panel px-4 py-3 shadow-[var(--shadow-soft)]">
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.35 + i * 0.25, type: "spring" }} className="grid h-6 w-6 place-items-center rounded-full bg-safe text-xs text-white">✓</motion.span>
            <span className="text-sm font-semibold">{o}</span>
          </motion.div>
        ))}
      </div>
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1 }} className="mt-auto rounded-2xl bg-ink p-4 text-center font-display text-lg font-bold text-bus">Trip closed</motion.div>
    </>
  );
}
