import { useEffect, useRef, useState, type RefObject } from "react";

// Small hand-drawn SVG charts: single series, thin marks, recessive grid, hover tooltip.

export interface Point { label: string; value: number | null; detail?: string }

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const PAD = { l: 34, r: 8, t: 10, b: 24 };
const fmtN = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n * 10) / 10));

function Frame({ w, h, max, n, labels, unit }: { w: number; h: number; max: number; n: number; labels: string[]; unit?: string }) {
  const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b, step = iw / Math.max(n, 1);
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 46))));
  return (
    <g>
      {[0, 0.5, 1].map((f) => {
        const y = PAD.t + ih - f * ih;
        return (
          <g key={f}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={1} strokeDasharray={f === 0 ? undefined : "2 4"} />
            <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-3)">{fmtN(max * f)}{f === 1 && unit ? unit : ""}</text>
          </g>
        );
      })}
      {labels.map((l, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every) ? (
        <text key={i} x={PAD.l + step * i + step / 2} y={h - 6} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">{l}</text>
      ) : null)}
    </g>
  );
}

function Tip({ x, y, point, fmt, w }: { x: number; y: number; point: Point; fmt: (v: number) => string; w: number }) {
  const left = Math.min(Math.max(x, 70), w - 70);
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg"
      style={{ left, top: y - 8 }}>
      <div className="font-bold">{point.label}</div>
      <div className="tabular">{point.value == null ? "No data" : fmt(point.value)}</div>
      {point.detail && <div className="text-white/70">{point.detail}</div>}
    </div>
  );
}

export function BarChart({ data, height = 170, color = "#2F6FB0", fmt = (v) => String(v), unit }: {
  data: Point[]; height?: number; color?: string; fmt?: (v: number) => string; unit?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value ?? 0)));
  const iw = w - PAD.l - PAD.r, ih = height - PAD.t - PAD.b, step = iw / Math.max(n, 1);
  const bw = Math.max(3, Math.min(24, step * 0.62));
  return (
    <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={data.map((d) => `${d.label}: ${d.value ?? "no data"}`).join(", ")}>
          <Frame w={w} h={height} max={max} n={n} labels={data.map((d) => d.label)} unit={unit} />
          {data.map((d, i) => {
            const v = d.value ?? 0, bh = (v / max) * ih, x = PAD.l + step * i + (step - bw) / 2, y = PAD.t + ih - bh, r = Math.min(4, bh, bw / 2);
            return (
              <g key={i}>
                {bh > 0 && <path d={`M${x},${y + bh} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${y + bh} Z`}
                  fill={color} opacity={hover == null || hover === i ? 1 : 0.45} />}
                <rect x={PAD.l + step * i} y={PAD.t} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && data[hover] && (
        <Tip w={w} x={PAD.l + step * hover + step / 2} y={PAD.t + ih - ((data[hover].value ?? 0) / max) * ih} point={data[hover]} fmt={fmt} />
      )}
    </div>
  );
}

export function LineChart({ data, height = 170, color = "#1F8A5B", fmt = (v) => String(v), maxValue, unit }: {
  data: Point[]; height?: number; color?: string; fmt?: (v: number) => string; maxValue?: number; unit?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  const max = maxValue ?? niceMax(Math.max(0, ...data.map((d) => d.value ?? 0)));
  const iw = w - PAD.l - PAD.r, ih = height - PAD.t - PAD.b, step = iw / Math.max(n, 1);
  const pts = data.map((d, i) => d.value == null ? null : [PAD.l + step * i + step / 2, PAD.t + ih - (d.value / max) * ih] as [number, number]);
  // break the line where data is missing
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
  if (cur.length) segs.push(cur);
  return (
    <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={data.map((d) => `${d.label}: ${d.value ?? "no data"}`).join(", ")}>
          <Frame w={w} h={height} max={max} n={n} labels={data.map((d) => d.label)} unit={unit} />
          {segs.map((s, i) => <polyline key={i} points={s.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
          {pts.map((p, i) => p && (
            <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 3.5} fill={color} stroke="white" strokeWidth={2} />
          ))}
          {hover != null && <line x1={PAD.l + step * hover + step / 2} x2={PAD.l + step * hover + step / 2} y1={PAD.t} y2={PAD.t + ih} stroke="var(--color-ink-3)" strokeWidth={1} strokeDasharray="3 3" />}
          {data.map((_, i) => <rect key={i} x={PAD.l + step * i} y={PAD.t} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        </svg>
      )}
      {hover != null && data[hover] && (
        <Tip w={w} x={PAD.l + step * hover + step / 2} y={pts[hover]?.[1] ?? PAD.t + ih} point={data[hover]} fmt={fmt} />
      )}
    </div>
  );
}

/** Thin horizontal progress meter with a label. */
export function Meter({ value, max, tone = "route", label }: { value: number; max: number; tone?: "route" | "safe" | "warn" | "alert"; label?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const c = { route: "bg-route", safe: "bg-safe", warn: "bg-warn", alert: "bg-alert" }[tone];
  return (
    <div>
      {label && <div className="mb-1 flex justify-between text-sm"><span className="text-ink-2">{label}</span><span className="font-semibold tabular">{value} / {max}</span></div>}
      <div className="h-2 overflow-hidden rounded-full bg-line-2"><div className={`h-full rounded-full ${c}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
