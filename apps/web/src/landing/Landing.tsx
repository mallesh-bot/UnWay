import { useEffect, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { BellRing, Languages, MessageCircle, Send } from "lucide-react";
import { Logo } from "../components/Shell";
import { useSmoothScroll } from "../components/SmoothScroll";
import HeroRoute from "./HeroRoute";
import Story from "./Story";
import { AutomationClock, Dashboards } from "./Sections";

const HEADLINE = ["Every", "child", "on", "the", "bus.", "Every", "parent", "in", "the", "loop."];

export default function Landing() {
  useSmoothScroll(undefined, []);
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const orbA = useTransform(scrollY, [0, 900], [0, -160]);
  const orbB = useTransform(scrollY, [0, 900], [0, 120]);
  const navShadow = useTransform(scrollY, [0, 80], ["0 0 0 rgba(0,0,0,0)", "var(--shadow-card)"]);

  useEffect(() => { document.title = "UnWay · Every child on the bus, accounted for"; }, []);
  const go = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    const lenis = (window as unknown as { __lenis?: { scrollTo: (t: string, o?: object) => void } }).__lenis;
    if (lenis) lenis.scrollTo(`#${id}`, { offset: -20 }); else document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="relative overflow-x-clip bg-surface text-ink">
      {/* ambient clay orbs */}
      <motion.div aria-hidden style={{ y: orbA }} className="pointer-events-none absolute -left-40 top-24 h-[520px] w-[520px] rounded-full bg-surface shadow-[30px_30px_70px_var(--neu-dark),-30px_-30px_70px_var(--neu-light)]" />
      <motion.div aria-hidden style={{ y: orbB }} className="pointer-events-none absolute -right-24 top-[560px] h-[360px] w-[360px] rounded-full bg-surface shadow-[inset_24px_24px_50px_var(--neu-dark),inset_-24px_-24px_50px_var(--neu-light)]" />

      {/* nav */}
      <header className="sticky top-3 z-40 px-3 sm:top-4">
        <motion.nav style={{ boxShadow: navShadow }} className="mx-auto flex max-w-6xl items-center gap-3 rounded-[24px] bg-surface/80 px-4 py-2.5 backdrop-blur-xl sm:px-5">
          <a href="#top" onClick={go("top")} className="flex items-center gap-2.5"><Logo size={34} /><span className="font-display text-xl font-extrabold">UnWay</span></a>
          <div className="ml-6 hidden flex-1 items-center gap-1 text-[15px] font-semibold text-ink-2 md:flex">
            <a href="#how" onClick={go("how")} className="rounded-xl px-3 py-2 transition-colors hover:text-ink">How a trip works</a>
            <a href="#dashboards" onClick={go("dashboards")} className="rounded-xl px-3 py-2 transition-colors hover:text-ink">Dashboards</a>
            <a href="#automation" onClick={go("automation")} className="rounded-xl px-3 py-2 transition-colors hover:text-ink">What runs itself</a>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/login" className="neu-press hidden rounded-2xl px-4 py-2.5 font-semibold sm:block">Sign in</Link>
            <Link to="/login?signup=1" className="neu-press rounded-2xl bg-ink px-4 py-2.5 font-semibold text-white shadow-[var(--shadow-soft)] sm:px-5">Start free</Link>
          </div>
        </motion.nav>
      </header>

      {/* hero */}
      <section id="top" className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-28 pt-14 lg:grid-cols-[1.02fr_1fr] lg:pt-20">
        <div>
          <h1 className="font-display text-[clamp(44px,6.6vw,84px)] font-extrabold leading-[0.98] tracking-[-0.035em]">
            {HEADLINE.map((w, i) => (
              <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
                <motion.span className="inline-block" initial={reduce ? false : { y: "110%", rotate: 4 }} animate={{ y: 0, rotate: 0 }}
                  transition={{ delay: 0.15 + i * 0.055, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>{w}&nbsp;</motion.span>
              </span>
            ))}
          </h1>
          <motion.p initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, duration: 0.7 }}
            className="mt-7 max-w-[46ch] text-[19px] leading-relaxed text-ink-2">
            Children scan a card as they get on and off. The school sees every bus live, and parents get a message the same second. On Telegram and in the browser, it's free.
          </motion.p>
          <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.7 }} className="mt-9 flex flex-wrap items-center gap-4">
            <Link to="/login?signup=1" className="neu-press rounded-[20px] bg-bus px-7 py-4 font-display text-lg font-extrabold text-ink shadow-[8px_8px_18px_rgba(190,145,0,.38),-8px_-8px_18px_var(--neu-light),inset_0_-3px_0_var(--color-bus-deep)]">
              Bring UnWay to your school
            </Link>
            <a href="#how" onClick={go("how")} className="neu-soft neu-press rounded-[20px] px-6 py-4 font-semibold">See a trip</a>
          </motion.div>
          <motion.ul initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.8 }} className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-ink-3">
            <li className="flex items-center gap-1.5"><Send size={15} /> Telegram</li>
            <li className="flex items-center gap-1.5"><MessageCircle size={15} /> WhatsApp</li>
            <li className="flex items-center gap-1.5"><BellRing size={15} /> Browser alerts</li>
            <li className="flex items-center gap-1.5"><Languages size={15} /> English, తెలుగు, हिन्दी</li>
          </motion.ul>
        </div>
        <motion.div initial={reduce ? false : { opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.3, duration: 1, ease: [0.22, 1, 0.36, 1] }}>
          <HeroRoute />
        </motion.div>
      </section>

      <Story />
      <Dashboards />
      <AutomationClock />

      {/* closing */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-10">
        <div className="relative overflow-hidden rounded-[44px] bg-ink px-6 py-16 text-center text-white shadow-[var(--shadow-pop)] sm:px-12">
          <div aria-hidden className="road absolute inset-x-12 bottom-8 opacity-40" />
          <h2 className="relative mx-auto max-w-[18ch] font-display text-[clamp(32px,5vw,58px)] font-extrabold leading-[1.02] tracking-tight">Set up a school before the next bell.</h2>
          <p className="relative mx-auto mt-5 max-w-[50ch] text-lg text-white/75">Upload your student sheet, let UnWay plan the routes, print the cards. Parents connect by scanning a slip. No app to install for them.</p>
          <div className="relative mt-9 flex flex-wrap justify-center gap-4">
            <Link to="/login?signup=1" className="neu-press rounded-[20px] bg-bus px-7 py-4 font-display text-lg font-extrabold text-ink">Create your school</Link>
            <Link to="/login" className="neu-press rounded-[20px] bg-white/10 px-7 py-4 font-semibold text-white hover:bg-white/15">Sign in</Link>
          </div>
          <p className="relative mt-8 text-sm text-white/55">Parents: you don't need an account. Open the link your school sent you.</p>
        </div>
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 px-2 text-sm text-ink-3">
          <span className="flex items-center gap-2"><Logo size={24} /> UnWay · made for Indian school mornings</span>
          <span>Telegram and browser alerts are free. WhatsApp costs about ₹0.12 a message, paid to Meta.</span>
        </footer>
      </section>
    </div>
  );
}
