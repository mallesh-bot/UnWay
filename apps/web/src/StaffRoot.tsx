import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { configured } from "./lib/supabase";
import { rememberedPortal } from "./parent/api";
import { Button } from "./components/ui";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";

const SchoolApp = lazy(() => import("./SchoolApp"));
const Landing = lazy(() => import("./landing/Landing"));
const PlatformApp = lazy(() => import("./platform/PlatformApp"));

function Splash() {
  return <div className="grid h-full place-items-center"><span className="plate plate-lg">U</span></div>;
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-xl p-10">
      <h1 className="text-2xl font-extrabold">Connect UnWay to Supabase</h1>
      <p className="mt-2 text-ink-2">
        Create <code className="rounded bg-panel px-1">apps/web/.env.local</code> with <code>VITE_SUPABASE_URL</code> and{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>), then restart the dev server.
      </p>
    </div>
  );
}

function Suspended() {
  const { org, signOut } = useAuth();
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md neu rounded-[22px] p-8 text-center shadow-card">
        <span className="plate plate-lg">U</span>
        <h1 className="mt-4 text-2xl font-extrabold">{org?.name} is paused</h1>
        <p className="mt-2 text-ink-2">UnWay is paused for this school, so bus phones and parent messages are off. Please contact the UnWay team to switch it back on.</p>
        <Button className="mt-5" onClick={signOut}>Sign out</Button>
      </div>
    </div>
  );
}

function Gate() {
  const { loading, session, org, isPlatform, viewingAsPlatform } = useAuth();
  const loc = useLocation();
  if (!configured) return <NotConfigured />;
  if (loading) return <Splash />;
  if (!session) {
    // a parent who installed their page to the home screen lands on "/"
    const portal = rememberedPortal();
    if (portal && window.matchMedia?.("(display-mode: standalone)").matches) return <Navigate to={`/p/${portal}`} replace />;
    if (loc.pathname === "/") return <Suspense fallback={<Splash />}><Landing /></Suspense>;
    return <Login />;
  }
  const inPlatform = loc.pathname.startsWith("/platform");
  if (loc.pathname === "/login") return <Navigate to={isPlatform && !org ? "/platform" : "/"} replace />;
  if (inPlatform) return isPlatform ? <Suspense fallback={<Splash />}><PlatformApp /></Suspense> : <Navigate to="/" replace />;
  if (!org) return isPlatform ? <Navigate to="/platform" replace /> : <Onboarding />;
  if (org.status === "suspended" && !viewingAsPlatform) return <Suspended />;
  return <Suspense fallback={<Splash />}><SchoolApp /></Suspense>;
}

export default function StaffRoot() {
  return (
    <AuthProvider>
      <Routes><Route path="*" element={<Gate />} /></Routes>
    </AuthProvider>
  );
}
