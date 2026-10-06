import { useRef, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { LogOut, Menu, X } from "lucide-react";
import { cx } from "./ui";
import { useSmoothScroll } from "./SmoothScroll";

export interface NavItem { to: string; label: string; icon: ComponentType<{ size?: number }>; end?: boolean; badge?: number; badgeTone?: "alert" | "bus" }
export interface NavGroup { label?: string; items: NavItem[] }

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="18" fill="#F6B800" />
      <rect x="12" y="17" width="40" height="27" rx="7" fill="#1F2A37" />
      <rect x="17" y="22" width="12" height="9" rx="2.5" fill="#F6B800" />
      <rect x="35" y="22" width="12" height="9" rx="2.5" fill="#F6B800" />
      <rect x="17" y="36" width="30" height="3" rx="1.5" fill="#F6B800" opacity=".5" />
      <circle cx="21" cy="47" r="4.5" fill="#1F2A37" /><circle cx="43" cy="47" r="4.5" fill="#1F2A37" />
    </svg>
  );
}

/** App frame shared by the school dashboard and the UnWay console. */
export default function Shell({ product, context, nav, user, onSignOut, banners, footerExtra }: {
  product: string; context?: ReactNode; nav: NavGroup[];
  user: { name: string; detail: string }; onSignOut: () => void; banners?: ReactNode; footerExtra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const outlet = useOutlet();
  const main = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  useSmoothScroll(main, []);

  return (
    <div className="flex h-full bg-surface">
      <aside className={cx(
        "no-print fixed inset-y-3 left-3 z-40 flex w-[264px] flex-col rounded-[28px] bg-surface shadow-[var(--shadow-card)] transition-transform duration-500 [transition-timing-function:var(--ease-soft)] lg:static lg:my-3 lg:ml-3 lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-[110%]")}>
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <span className="rounded-[14px] shadow-[var(--shadow-soft)]"><Logo size={40} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] font-extrabold leading-tight">UnWay <span className="text-bus-deep">{product}</span></div>
            {context && <div className="truncate text-xs font-medium text-ink-3">{context}</div>}
          </div>
          <button className="rounded-lg p-1 text-ink-3 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={20} /></button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4" data-lenis-prevent>
          {nav.map((g, gi) => (
            <div key={gi} className="mt-4 first:mt-1">
              {g.label && <div className="px-3 pb-1.5 text-xs font-semibold text-ink-3">{g.label}</div>}
              <div className="space-y-1">
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
                    className={({ isActive }) => cx(
                      "relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[15px] font-semibold transition-all duration-300",
                      isActive ? "text-ink shadow-[inset_3px_3px_7px_var(--neu-dark),inset_-3px_-3px_7px_var(--neu-light)]" : "text-ink-2 hover:text-ink hover:shadow-[3px_3px_8px_var(--neu-dark),-3px_-3px_8px_var(--neu-light)]")}>
                    {({ isActive }) => <>
                      <span className={cx("grid h-7 w-7 place-items-center rounded-lg transition-colors", isActive ? "bg-bus text-ink" : "text-ink-3")}><n.icon size={17} /></span>
                      <span className="flex-1">{n.label}</span>
                      {!!n.badge && n.badge > 0 && (
                        <span className={cx("rounded-full px-2 text-xs font-bold tabular", n.badgeTone === "bus" ? "bg-bus text-ink" : "bg-alert text-white")}>{n.badge}</span>
                      )}
                    </>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        {footerExtra}
        <div className="m-3 flex items-center gap-3 rounded-2xl px-3 py-3 text-sm shadow-[inset_3px_3px_7px_var(--neu-dark),inset_-3px_-3px_7px_var(--neu-light)]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink font-display font-bold text-bus">{user.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{user.name}</div>
            <div className="truncate text-xs text-ink-3">{user.detail}</div>
          </div>
          <button onClick={onSignOut} className="rounded-lg p-1.5 text-ink-3 hover:text-alert" aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-ink/20 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="no-print flex items-center gap-3 px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="neu-soft neu-press rounded-xl p-2"><Menu size={20} /></button>
          <Logo size={28} /><span className="font-display font-extrabold">UnWay <span className="text-bus-deep">{product}</span></span>
        </div>
        {banners && <div className="px-4 pt-3 lg:px-8">{banners}</div>}
        <main ref={main} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={loc.pathname}
                initial={reduce ? false : { opacity: 0, y: 14, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduce ? undefined : { opacity: 0, y: -8, filter: "blur(2px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
                {outlet}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
