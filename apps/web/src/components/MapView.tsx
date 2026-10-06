import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export const MAP_STYLE = (import.meta.env.VITE_MAP_STYLE as string) || "https://tiles.openfreemap.org/styles/positron";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: "bus" | "stop" | "school" | "point" | "alert";
  label?: string;
  tone?: "ok" | "late" | "offline" | "alert" | "idle";
  popup?: string;
  draggable?: boolean;
  color?: string;                    // stop ring colour (route identity)
}

interface Props {
  markers: MapMarker[];
  line?: [number, number][];         // [lat, lng][]
  lines?: { coords: [number, number][]; color: string }[];  // several coloured routes
  track?: [number, number][];        // recorded GPS track
  circles?: { lat: number; lng: number; radius: number; color?: string }[];
  center?: [number, number];         // [lat, lng]
  zoom?: number;
  fitKey?: string;                   // change to re-fit bounds
  onMapClick?: (lat: number, lng: number) => void;
  onMarkerClick?: (id: string) => void;
  onMarkerDrag?: (id: string, lat: number, lng: number) => void;
  className?: string;
}

function markerEl(m: MapMarker): HTMLElement {
  const el = document.createElement("div");
  if (m.kind === "bus") {
    const colors: Record<string, string> = { ok: "#F2B705", late: "#F2B705", offline: "#9AA7B0", alert: "#C8372D", idle: "#F2B705" };
    el.className = m.tone === "alert" ? "sos-pulse" : "";
    el.style.cssText = `background:${colors[m.tone ?? "ok"]};color:${m.tone === "alert" ? "#fff" : "#1E2A32"};border:2px solid #1E2A32;border-radius:6px;padding:1px 7px;font-weight:800;font-size:13px;font-family:inherit;box-shadow:0 2px 6px rgba(30,42,50,.35);cursor:pointer;white-space:nowrap`;
    el.textContent = m.label ?? "Bus";
  } else if (m.kind === "stop") {
    el.style.cssText = `width:24px;height:24px;border-radius:50%;background:#fff;border:3px solid ${m.color ?? "#2F6FB0"};color:#1E2A32;font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center;cursor:pointer`;
    el.textContent = m.label ?? "";
  } else if (m.kind === "school") {
    el.style.cssText = "width:30px;height:30px;border-radius:8px;background:#1E2A32;color:#F2B705;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;border:2px solid #F2B705";
    el.textContent = "S";
    el.title = m.label ?? "School";
  } else if (m.kind === "alert") {
    el.className = "sos-pulse";
    el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#C8372D;border:3px solid #fff";
  } else {
    el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#C8372D;border:2px solid #fff;box-shadow:0 0 0 2px #C8372D";
  }
  return el;
}

export default function MapView({ markers, line, lines, track, circles, center, zoom = 12, fitKey, onMapClick, onMarkerClick, onMarkerDrag, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [ready, setReady] = useState(false);
  const cb = useRef({ onMapClick, onMarkerClick, onMarkerDrag });
  cb.current = { onMapClick, onMarkerClick, onMarkerDrag };

  // init
  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: MAP_STYLE,
      center: center ? [center[1], center[0]] : [78.4867, 17.385],
      zoom,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("click", (e) => cb.current.onMapClick?.(e.lngLat.lat, e.lngLat.lng));
    m.on("load", () => {
      m.addSource("route-line", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "route-line", type: "line", source: "route-line", paint: { "line-color": "#2F6FB0", "line-width": 4, "line-opacity": 0.7, "line-dasharray": [2, 1.5] } });
      m.addSource("multi-lines", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "multi-lines", type: "line", source: "multi-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.85 } });
      m.addSource("track-line", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "track-line", type: "line", source: "track-line", paint: { "line-color": "#1E2A32", "line-width": 3, "line-opacity": 0.8 } });
      m.addSource("circles", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "circles", type: "fill", source: "circles", paint: { "fill-color": ["coalesce", ["get", "color"], "#2F6FB0"], "fill-opacity": 0.12 } });
      setReady(true);
    });
    map.current = m;
    const refs = markerRefs.current;
    return () => { refs.forEach((mk) => mk.remove()); refs.clear(); m.remove(); map.current = null; setReady(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const refs = markerRefs.current;
    const keyOf = (x: MapMarker) => x.id + x.kind + (x.label ?? "") + (x.tone ?? "") + (x.color ?? "");
    const keep = new Set(markers.map(keyOf));
    refs.forEach((mk, key) => { if (!keep.has(key)) { mk.remove(); refs.delete(key); } });
    for (const x of markers) {
      const key = keyOf(x);
      let mk = refs.get(key);
      if (!mk) {
        const el = markerEl(x);
        el.addEventListener("click", (ev) => { ev.stopPropagation(); cb.current.onMarkerClick?.(x.id); });
        mk = new maplibregl.Marker({ element: el, draggable: !!x.draggable }).setLngLat([x.lng, x.lat]);
        if (x.popup) mk.setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(x.popup));
        if (x.draggable) mk.on("dragend", () => { const p = mk!.getLngLat(); cb.current.onMarkerDrag?.(x.id, p.lat, p.lng); });
        mk.addTo(m);
        refs.set(key, mk);
      } else {
        mk.setLngLat([x.lng, x.lat]);
      }
    }
  }, [markers]);

  // lines & circles
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    {
      const lineSrc = m.getSource("route-line") as maplibregl.GeoJSONSource | undefined;
      lineSrc?.setData({ type: "FeatureCollection", features: line && line.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line.map(([a, b]) => [b, a]) } }] : [] });
      const multi = m.getSource("multi-lines") as maplibregl.GeoJSONSource | undefined;
      multi?.setData({ type: "FeatureCollection", features: (lines ?? []).filter((l) => l.coords.length > 1).map((l) => ({
        type: "Feature", properties: { color: l.color }, geometry: { type: "LineString", coordinates: l.coords.map(([a, b]) => [b, a]) } })) });
      const trackSrc = m.getSource("track-line") as maplibregl.GeoJSONSource | undefined;
      trackSrc?.setData({ type: "FeatureCollection", features: track && track.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: track.map(([a, b]) => [b, a]) } }] : [] });
      const circSrc = m.getSource("circles") as maplibregl.GeoJSONSource | undefined;
      circSrc?.setData({
        type: "FeatureCollection",
        features: (circles ?? []).map((c) => ({ type: "Feature", properties: { color: c.color ?? "#2F6FB0" }, geometry: { type: "Polygon", coordinates: [circlePoly(c.lat, c.lng, c.radius)] } })),
      });
    }
  }, [line, lines, track, circles, ready]);

  // fit bounds when fitKey changes
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pts: [number, number][] = [...markers.map((x) => [x.lat, x.lng] as [number, number]), ...(line ?? []), ...(track ?? []), ...(lines ?? []).flatMap((l) => l.coords)]
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    if (pts.length === 0) { if (center) m.jumpTo({ center: [center[1], center[0]], zoom }); return; }
    if (pts.length === 1) { m.jumpTo({ center: [pts[0][1], pts[0][0]], zoom: 15 }); return; }
    const b = new maplibregl.LngLatBounds();
    pts.forEach(([a, c]) => b.extend([c, a]));
    m.fitBounds(b, { padding: 60, maxZoom: 16, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={box} className={className ?? "h-96 w-full rounded-xl"} />;
}

function circlePoly(lat: number, lng: number, radiusM: number): [number, number][] {
  const pts: [number, number][] = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return pts;
}
