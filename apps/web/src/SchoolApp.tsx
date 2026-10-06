import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, BarChart3, Bus, CalendarDays, ClipboardList, Home, IdCard, Map as MapIcon, Radar, Settings, Siren, Sparkles, Users, UsersRound, Eye,
} from "lucide-react";
import { useAuth } from "./lib/auth";
import { rpc, supabase } from "./lib/supabase";
import Shell, { type NavGroup } from "./components/Shell";
import { Button, Loading } from "./components/ui";

const HomePage = lazy(() => import("./pages/Home"));
const LiveBoard = lazy(() => import("./pages/LiveBoard"));
const Students = lazy(() => import("./pages/Students"));
const StudentDetail = lazy(() => import("./pages/StudentDetail"));
const ImportStudents = lazy(() => import("./pages/ImportStudents"));
const Cards = lazy(() => import("./pages/Cards"));
const Parents = lazy(() => import("./pages/Parents"));
const Buses = lazy(() => import("./pages/Buses"));
const RoutesPage = lazy(() => import("./pages/Routes"));
const RouteEditor = lazy(() => import("./pages/RouteEditor"));
const AutoPlan = lazy(() => import("./pages/AutoPlan"));
const Trips = lazy(() => import("./pages/Trips"));
const TripDetail = lazy(() => import("./pages/TripDetail"));
const Exceptions = lazy(() => import("./pages/Exceptions"));
const Reports = lazy(() => import("./pages/Reports"));
const CalendarPage = lazy(() => import("./pages/Calendar"));
const SettingsPage = lazy(() => import("./pages/Settings"));

function useAlertCounts(orgId?: string) {
  const q = useQuery({
    queryKey: ["alert-counts", orgId],
    enabled: !!orgId,
    refetchInterval: 20000,
    queryFn: async () => {
      const [ex, inc] = await Promise.all([
        supabase.from("exceptions").select("id", { count: "exact", head: true }).neq("status", "resolved"),
        supabase.from("incidents").select("id,bus_id,type,created_at", { count: "exact" }).eq("status", "open").like("type", "sos%"),
      ]);
      return { exceptions: ex.count ?? 0, sos: inc.data ?? [] };
    },
  });
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase.channel("alerts-" + orgId)
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents", filter: `org_id=eq.${orgId}` }, () => q.refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "exceptions", filter: `org_id=eq.${orgId}` }, () => q.refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  return q.data;
}

function SosAlarm({ count }: { count: number }) {
  const [last, setLast] = useState(0);
  useEffect(() => {
    if (count > last) {
      try {
        const ctx = new AudioContext();
        [0, 0.35, 0.7].forEach((t) => {
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
          g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
          o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
        });
      } catch { /* autoplay blocked */ }
    }
    setLast(count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);
  return null;
}

const ROLE_LABEL: Record<string, string> = { school_admin: "School admin", transport_manager: "Transport manager", viewer: "Viewer" };

function PlatformViewBanner() {
  const { org, refresh } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  return (
    <div className="no-print mb-1 flex flex-wrap items-center gap-3 rounded-2xl bg-bus px-5 py-2.5 font-semibold text-ink shadow-[var(--shadow-soft)]">
      <Eye size={18} /> <span className="flex-1">You're viewing <b>{org?.name}</b> as the UnWay team. Read-only.</span>
      <Button size="sm" variant="primary" onClick={async () => { await rpc("platform_view_school", { p_org: null }); qc.clear(); await refresh(); nav("/platform/schools"); }}>
        Back to console
      </Button>
    </div>
  );
}

export default function SchoolApp() {
  const { org, member, signOut, viewingAsPlatform } = useAuth();
  const counts = useAlertCounts(org?.id);
  const sosCount = counts?.sos.length ?? 0;

  const nav: NavGroup[] = [
    { label: "Today", items: [
      { to: "/", label: "Home", icon: Home, end: true },
      { to: "/live", label: "Live map", icon: Radar },
      { to: "/trips", label: "Trips", icon: ClipboardList },
      { to: "/exceptions", label: "Alerts", icon: AlertTriangle, badge: counts?.exceptions },
    ] },
    { label: "People", items: [
      { to: "/students", label: "Students", icon: Users },
      { to: "/parents", label: "Parents", icon: UsersRound },
      { to: "/cards", label: "QR cards", icon: IdCard },
    ] },
    { label: "Transport", items: [
      { to: "/buses", label: "Buses & crew", icon: Bus },
      { to: "/routes", label: "Routes & stops", icon: MapIcon, end: true },
      { to: "/routes/plan", label: "Auto-plan routes", icon: Sparkles },
      { to: "/calendar", label: "Calendar", icon: CalendarDays },
    ] },
    { label: "Insights", items: [
      { to: "/reports", label: "Reports", icon: BarChart3 },
      { to: "/settings", label: "Settings", icon: Settings },
    ] },
  ];

  return (
    <Routes>
      <Route element={
        <>
          <SosAlarm count={sosCount} />
          <Shell product="School" context={org?.name} nav={nav} onSignOut={signOut}
            user={{ name: member?.name || member?.email || "You", detail: viewingAsPlatform ? "UnWay team (read-only)" : ROLE_LABEL[member?.role ?? ""] ?? "" }}
            banners={<>
              {viewingAsPlatform && <PlatformViewBanner />}
              {sosCount > 0 && (
                <NavLink to="/exceptions?tab=incidents" className="no-print sos-pulse mt-2 flex items-center gap-3 rounded-2xl bg-alert px-5 py-3 font-bold text-white">
                  <Siren size={22} /> {sosCount === 1 ? "SOS from a bus. Open now." : `${sosCount} SOS alerts open. Open now.`}
                </NavLink>
              )}
            </>} />
        </>
      }>
        <Route index element={<S><HomePage /></S>} />
        <Route path="live" element={<S><LiveBoard /></S>} />
        <Route path="trips" element={<S><Trips /></S>} />
        <Route path="trips/:id" element={<S><TripDetail /></S>} />
        <Route path="exceptions" element={<S><Exceptions /></S>} />
        <Route path="students" element={<S><Students /></S>} />
        <Route path="students/import" element={<S><ImportStudents /></S>} />
        <Route path="students/:id" element={<S><StudentDetail /></S>} />
        <Route path="cards" element={<S><Cards /></S>} />
        <Route path="parents" element={<S><Parents /></S>} />
        <Route path="buses" element={<S><Buses /></S>} />
        <Route path="routes" element={<S><RoutesPage /></S>} />
        <Route path="routes/plan" element={<S><AutoPlan /></S>} />
        <Route path="routes/:id" element={<S><RouteEditor /></S>} />
        <Route path="calendar" element={<S><CalendarPage /></S>} />
        <Route path="reports" element={<S><Reports /></S>} />
        <Route path="settings" element={<S><SettingsPage /></S>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}
