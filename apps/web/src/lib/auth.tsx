import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Campus, Organization, OrgUser, Role } from "./types";

export interface Membership {
  platform_admin: boolean;
  org_id: string | null;
  org_status: "trial" | "active" | "suspended" | null;
  role: Role | null;
  viewing_as_platform: boolean;
  name: string | null;
  email: string | null;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  membership: Membership | null;
  member: OrgUser | null;
  org: Organization | null;
  campus: Campus | null;
  canWrite: boolean;
  isAdmin: boolean;
  isPlatform: boolean;
  viewingAsPlatform: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [campus, setCampus] = useState<Campus | null>(null);

  const loadMembership = useCallback(async (s: Session | null) => {
    if (!s) { setMembership(null); setOrg(null); setCampus(null); return; }
    const { data: m } = await supabase.rpc("my_membership");
    const mem = (m as Membership) ?? null;
    setMembership(mem);
    if (mem?.org_id) {
      const [{ data: o }, { data: c }] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", mem.org_id).single(),
        supabase.from("campuses").select("*").eq("org_id", mem.org_id).order("created_at").limit(1).maybeSingle(),
      ]);
      setOrg(o as Organization);
      setCampus((c as Campus) ?? null);
    } else { setOrg(null); setCampus(null); }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadMembership(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        // defer to avoid calling supabase inside the auth callback
        setTimeout(() => { loadMembership(s); }, 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadMembership]);

  const refresh = useCallback(async () => { await loadMembership(session); }, [loadMembership, session]);
  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);

  const role = membership?.role ?? null;
  const member: OrgUser | null = membership?.org_id && role ? {
    user_id: session?.user.id ?? "", org_id: membership.org_id, role, name: membership.name, email: membership.email,
  } : null;
  return (
    <Ctx.Provider value={{
      loading, session, membership, member, org, campus,
      canWrite: role === "school_admin" || role === "transport_manager",
      isAdmin: role === "school_admin",
      isPlatform: !!membership?.platform_admin,
      viewingAsPlatform: !!membership?.viewing_as_platform,
      refresh, signOut,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
}

/** Org settings merged with defaults (mirrors public.default_settings()). */
export function useSettings() {
  const { org } = useAuth();
  const s = (org?.settings ?? {}) as Record<string, unknown>;
  const channels = { whatsapp: false, telegram: true, webpush: true, email: false, ...(s.channels as object ?? {}) } as Record<string, boolean>;
  return {
    dup_window_s: Number(s.dup_window_s ?? 120),
    late_start_min: Number(s.late_start_min ?? 10),
    overspeed_kmh: Number(s.overspeed_kmh ?? 40),
    allow_bulk_deboard: s.allow_bulk_deboard !== false,
    drop_far_m: Number(s.drop_far_m ?? 300),
    device_offline_min: Number(s.device_offline_min ?? 3),
    track_base_url: String(s.track_base_url ?? ""),
    staff_telegram_chat_ids: (s.staff_telegram_chat_ids as string[]) ?? [],
    approaching_alert: s.approaching_alert !== false,
    approaching_m: Number(s.approaching_m ?? 1200),
    approaching_whatsapp: s.approaching_whatsapp === true,
    auto_whatsapp_invite: s.auto_whatsapp_invite !== false,
    escalate_after_min: Number(s.escalate_after_min ?? 5),
    evening_summary: s.evening_summary !== false,
    learn_stop_times: s.learn_stop_times !== false,
    channels,
  };
}
