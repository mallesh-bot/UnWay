import { useEffect, type ComponentType, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { X } from "lucide-react";
import type { CustodyState } from "../lib/types";
import { STATE_LABEL, STATE_TONE } from "../lib/format";

function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(" "); }
export { cx };

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "bus";
export function Button({ variant = "secondary", size = "md", className, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  const v: Record<BtnVariant, string> = {
    primary: "bg-ink text-white shadow-[5px_5px_12px_var(--neu-dark),-5px_-5px_12px_var(--neu-light)] hover:bg-ink-2",
    secondary: "bg-panel text-ink shadow-[5px_5px_12px_var(--neu-dark),-5px_-5px_12px_var(--neu-light)] hover:text-route",
    ghost: "text-ink-2 hover:bg-white/50",
    danger: "bg-alert text-white shadow-[5px_5px_12px_var(--neu-dark),-5px_-5px_12px_var(--neu-light)] hover:brightness-110",
    bus: "bg-bus text-ink font-bold shadow-[5px_5px_12px_rgba(190,145,0,.4),-5px_-5px_12px_var(--neu-light),inset_0_-2px_0_var(--color-bus-deep)] hover:brightness-105",
  };
  return (
    <button
      {...p}
      className={cx(
        "neu-press inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold whitespace-nowrap transition-[color,background-color,box-shadow,transform] duration-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
        size === "sm" ? "h-8 px-3 text-sm" : "h-11 px-5 text-[15px]",
        v[variant], className)}
    />
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-semibold text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

const inputCls = "h-11 rounded-xl border border-transparent bg-surface px-3.5 text-[15px] shadow-[inset_3px_3px_7px_var(--neu-dark),inset_-3px_-3px_7px_var(--neu-light)] outline-none transition-[border-color,box-shadow] duration-300 placeholder:text-ink-3/70 focus:border-route/40 disabled:opacity-60";
// full width unless the caller sets an explicit width
const width = (c?: string) => (c && /(^|\s)w-/.test(c) ? "" : "w-full");
export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(inputCls, width(p.className), p.className)} />;
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(inputCls, width(p.className), "pr-8", p.className)} />;
}
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(inputCls, width(p.className), "h-auto min-h-20 py-2", p.className)} />;
}

export function Badge({ tone = "muted", children, className }: { tone?: "safe" | "alert" | "warn" | "route" | "muted" | "ink"; children: ReactNode; className?: string }) {
  const t = {
    safe: "bg-safe-soft text-safe", alert: "bg-alert-soft text-alert", warn: "bg-warn-soft text-warn",
    route: "bg-route-soft text-route", muted: "bg-surface text-ink-2 shadow-[inset_1px_1px_3px_var(--neu-dark),inset_-1px_-1px_3px_var(--neu-light)]", ink: "bg-ink text-white",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", t, className)}>{children}</span>;
}

export function StateBadge({ state }: { state: CustodyState }) {
  return <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>;
}

export function Plate({ children, large }: { children: ReactNode; large?: boolean }) {
  return <span className={cx("plate", large && "plate-lg")}>{children}</span>;
}

/** Segmented custody bar: dropped | on board | missing | expected */
export function CustodyBar({ expected, onBoard, dropped, missing }: { expected: number; onBoard: number; dropped: number; missing: number }) {
  const total = Math.max(expected, 1);
  const waiting = Math.max(expected - onBoard - dropped - missing, 0);
  const seg = (n: number, cls: string, label: string) =>
    n > 0 ? <div className={cls} style={{ width: `${(n / total) * 100}%` }} title={`${label}: ${n}`} /> : null;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line" role="img"
      aria-label={`${dropped} dropped, ${onBoard} on bus, ${missing} missing, ${waiting} waiting`}>
      {seg(dropped, "bg-safe", "Dropped")}
      {seg(onBoard, "bg-route", "On bus")}
      {seg(missing, "bg-alert", "Missing")}
    </div>
  );
}

export function Panel({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("neu rounded-[22px]", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-6 pb-2 pt-5">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? "px-6 pb-6 pt-3" : "pb-2"}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, sub, actions, eyebrow }: { title: string; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="mb-1 text-sm font-semibold text-ink-3">{eyebrow}</div>}
        <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-ink-3">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-lg font-bold">{title}</p>
      {children && <p className="max-w-md text-ink-3">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="p-8 text-center text-ink-3">{label}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-lg border border-alert/30 bg-alert-soft p-3 text-sm text-alert">{(error as Error).message ?? String(error)}</div>;
}

export function Drawer({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/25 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-label={title}
        className={cx("drawer-in flex h-full w-full flex-col bg-panel shadow-[var(--shadow-pop)] outline-none", wide ? "max-w-3xl" : "max-w-lg")}>
        <header className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-surface" aria-label="Close"><X size={20} /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 px-6 pb-5 pt-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={title} className="rise w-full max-w-md rounded-[26px] bg-panel shadow-[var(--shadow-pop)]">
        <header className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-surface" aria-label="Close"><X size={20} /></button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 px-6 pb-5 pt-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[13px] text-ink-3">
          <tr>{head.map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-white/35">{children}</tbody>
      </table>
    </div>
  );
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("px-4 py-3 align-middle", className)}>{children}</td>;
}

export function Avatar({ src, name, size = 36 }: { src?: string | null; name: string; size?: number }) {
  if (src) return <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="inline-flex items-center justify-center rounded-full bg-route-soft font-display font-bold text-route shadow-[inset_1px_1px_3px_rgba(0,0,0,.08)]" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}

export function Kpi({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "alert" | "warn" | "safe"; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className={cx("font-display text-3xl font-extrabold tabular leading-none",
        tone === "alert" && "text-alert", tone === "warn" && "text-warn", tone === "safe" && "text-safe")}>{value}</div>
      <div className="mt-1 text-sm text-ink-3" title={hint}>{label}</div>
    </div>
  );
}

/** Metric tile with icon: the main building block of overview pages. */
export function Stat({ label, value, icon: Icon, tone = "ink", hint, to }: {
  label: string; value: ReactNode; icon?: ComponentType<{ size?: number; className?: string }>;
  tone?: "ink" | "alert" | "warn" | "safe" | "route" | "bus"; hint?: ReactNode; to?: string;
}) {
  const t = { ink: "bg-surface text-ink-2", alert: "bg-alert-soft text-alert", warn: "bg-warn-soft text-warn", safe: "bg-safe-soft text-safe", route: "bg-route-soft text-route", bus: "bg-bus-soft text-ink" }[tone];
  const body = (
    <div className="neu flex h-full items-start gap-3.5 rounded-[22px] p-5">
      {Icon && <span className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-2xl shadow-[inset_2px_2px_5px_rgba(0,0,0,.08),inset_-2px_-2px_5px_rgba(255,255,255,.7)]", t)}><Icon size={20} /></span>}
      <div className="min-w-0">
        <div className={cx("font-display text-[28px] font-extrabold leading-none tabular", tone === "alert" && "text-alert", tone === "warn" && "text-warn")}>{value}</div>
        <div className="mt-1 text-sm font-semibold text-ink-2">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-ink-3">{hint}</div>}
      </div>
    </div>
  );
  return to ? <a href={to} className="block transition-transform duration-500 [transition-timing-function:var(--ease-soft)] hover:-translate-y-1">{body}</a> : body;
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full shadow-[inset_2px_2px_5px_var(--neu-dark),inset_-2px_-2px_5px_var(--neu-light)] transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-safe" : "bg-surface")}>
      <span className={cx("inline-block h-5.5 w-5.5 rounded-full bg-panel shadow-[2px_2px_5px_rgba(0,0,0,.2)] transition-transform duration-300 [transition-timing-function:var(--ease-soft)]", checked ? "translate-x-[23px]" : "translate-x-[3px]")} />
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-2xl bg-surface p-1.5 shadow-[inset_3px_3px_7px_var(--neu-dark),inset_-3px_-3px_7px_var(--neu-light)]" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cx("rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-all duration-300", value === it.value ? "bg-panel text-ink shadow-[3px_3px_8px_var(--neu-dark),-3px_-3px_8px_var(--neu-light)]" : "text-ink-3 hover:text-ink")}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone = "route", icon: Icon, title, children, action }: {
  tone?: "route" | "warn" | "alert" | "safe" | "bus"; icon?: ComponentType<{ size?: number; className?: string }>;
  title: ReactNode; children?: ReactNode; action?: ReactNode;
}) {
  const t = { route: "border-route/25 bg-route-soft", warn: "border-warn/25 bg-warn-soft", alert: "border-alert/25 bg-alert-soft", safe: "border-safe/25 bg-safe-soft", bus: "border-bus-deep/30 bg-bus-soft" }[tone];
  return (
    <div className={cx("flex flex-wrap items-center gap-3 rounded-[20px] border px-5 py-3.5", t)}>
      {Icon && <Icon size={20} className="shrink-0" />}
      <div className="min-w-0 flex-1"><div className="font-bold">{title}</div>{children && <div className="text-sm text-ink-2">{children}</div>}</div>
      {action}
    </div>
  );
}
