export interface Overview {
  schools: number; schools_active: number; schools_trial: number; buses: number; students: number; guardians: number;
  guardians_connected: number; devices_paired: number; devices_seen_1h: number; trips_today: number; trips_active: number;
  scans_today: number; open_sos: number; open_critical: number; outbox_queued: number; messages_24h: Record<string, number>;
  failed_24h: number; whatsapp_30d: number; db_bytes: number; daily: { day: string; scans: number; messages: number }[];
}

export interface SchoolRow {
  id: string; name: string; short_code: string; status: "trial" | "active" | "suspended"; plan: string; created_at: string;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null; notes: string | null;
  buses: number; students: number; guardians: number; connected: number; devices: number;
  admins: { email: string | null; role: string; name: string | null }[];
  trips_7d: number; scans_7d: number; messages_30d: number; whatsapp_30d: number; open_exceptions: number; last_activity: string | null;
}

export interface MessageRow { id: string; school: string | null; event: string; channel: string; status: string; error: string | null; attempts: number; created_at: string }

export interface HealthInfo {
  jobs: { job: string; schedule: string; last_status: string | null; last_run: string | null; message: string | null }[];
  dispatch_wired: boolean; db_bytes: number; db_limit_bytes: number; tables: { table: string; bytes: number }[];
  oldest_queued: string | null; platform_admins: string[];
}

export const WHATSAPP_RATE_INR = 0.115;
export const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
