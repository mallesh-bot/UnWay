import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, Building2, Gauge, MessageSquareWarning, UsersRound } from "lucide-react";
import { useAuth } from "../lib/auth";
import { rpc } from "../lib/supabase";
import Shell, { type NavGroup } from "../components/Shell";
import { Loading } from "../components/ui";
import type { Overview } from "./types";

const OverviewPage = lazy(() => import("./Overview"));
const Schools = lazy(() => import("./Schools"));
const Messages = lazy(() => import("./Messages"));
const Health = lazy(() => import("./Health"));
const Team = lazy(() => import("./Team"));

export default function PlatformApp() {
  const { session, signOut } = useAuth();
  const ov = useQuery({ queryKey: ["platform-overview"], queryFn: () => rpc<Overview>("platform_overview"), refetchInterval: 30_000 });
  const nav: NavGroup[] = [
    { items: [
      { to: "/platform", label: "Overview", icon: Gauge, end: true },
      { to: "/platform/schools", label: "Schools", icon: Building2, badge: ov.data?.schools_trial, badgeTone: "bus" },
      { to: "/platform/messages", label: "Messages", icon: MessageSquareWarning, badge: ov.data?.failed_24h },
      { to: "/platform/health", label: "System health", icon: Activity },
      { to: "/platform/team", label: "UnWay team", icon: UsersRound },
    ] },
  ];
  return (
    <Routes>
      <Route path="platform" element={
        <Shell product="Console" context="All schools" nav={nav} onSignOut={signOut}
          user={{ name: session?.user.email ?? "You", detail: "UnWay team" }} />
      }>
        <Route index element={<S><OverviewPage /></S>} />
        <Route path="schools" element={<S><Schools /></S>} />
        <Route path="messages" element={<S><Messages /></S>} />
        <Route path="health" element={<S><Health /></S>} />
        <Route path="team" element={<S><Team /></S>} />
        <Route path="*" element={<Navigate to="/platform" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/platform" replace />} />
    </Routes>
  );
}

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}
