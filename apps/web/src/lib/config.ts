import { useQuery } from "@tanstack/react-query";
import { adminTool, TRACK_BASE_URL } from "./supabase";

export interface PublicConfig {
  telegram_bot: string | null;
  vapid_public_key: string | null;
  whatsapp_configured: boolean;
  track_base_url: string | null;
}

/** Server-side config (bot username etc). Falls back gracefully if functions aren't deployed yet. */
export function usePublicConfig() {
  return useQuery({
    queryKey: ["public-config"],
    staleTime: 10 * 60_000,
    retry: 0,
    queryFn: async () => {
      try { return await adminTool<PublicConfig>({ action: "config" }); }
      catch { return { telegram_bot: null, vapid_public_key: null, whatsapp_configured: false, track_base_url: null } as PublicConfig; }
    },
  });
}

export function trackBase(cfg?: PublicConfig | null, orgSetting?: string): string {
  return (orgSetting || TRACK_BASE_URL || cfg?.track_base_url || "").replace(/\/$/, "");
}

export function telegramLink(bot: string | null | undefined, inviteCode: string): string | null {
  return bot ? `https://t.me/${bot}?start=${inviteCode}` : null;
}
export function joinLink(base: string, inviteCode: string): string | null {
  return base ? `${base}/join/${inviteCode}` : null;
}
