import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";

// Three dashboards in one site, each loaded only when opened:
//   /p/<token>, /t/<token>, /join/<code>  → parents (no password)
//   /platform/*                          → UnWay team console
//   everything else                      → school dashboard
const ParentPortal = lazy(() => import("./parent/ParentPortal"));
const TrackRoute = lazy(() => import("./parent/TrackPage"));
const JoinPage = lazy(() => import("./parent/JoinPage"));
const StaffRoot = lazy(() => import("./StaffRoot"));

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

export function Splash() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-3 text-ink-3">
        <span className="plate plate-lg">U</span>
        <div className="road w-24 opacity-70" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Suspense fallback={<Splash />}>
          <Routes>
            <Route path="/p/:token" element={<ParentPortal />} />
            <Route path="/t/:token" element={<TrackRoute />} />
            <Route path="/join/:code" element={<JoinPage />} />
            <Route path="/*" element={<StaffRoot />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
