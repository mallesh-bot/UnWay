export type Direction = "MORNING" | "AFTERNOON";
export type CustodyState =
  | "EXPECTED" | "ABSENT_NOTIFIED" | "ON_BOARD" | "DROPPED" | "MISSED" | "NO_SHOW"
  | "HANDED_OVER" | "UNCONFIRMED" | "TRANSFERRED";

export interface Config { url: string; key: string; token: string; deviceId: string }

export interface Crew { id: string; name: string; role: "driver" | "attendant"; pin_hash: string | null }
export interface TripSummary {
  id: string; direction: Direction; route_code: string; route_name: string; scheduled_start: string;
  status: string; started_at: string | null; completed_at: string | null; expected: number;
}
export interface Bootstrap {
  server_ts: string; today: string;
  bus: { id: string; display_number: string; registration_no: string | null; capacity: number };
  org: { id: string; name: string; short_code: string; timezone: string; logo_url: string | null };
  campus: { name: string; lat: number | null; lng: number | null; radius_m: number; desk_phone: string | null } | null;
  policies: { dup_window_s: number; allow_bulk_deboard: boolean; overspeed_kmh: number; min_app_version?: string };
  crew: Crew[];
  trips: TripSummary[];
}
export interface Stop {
  id: string; name: string; landmark: string | null; lat: number; lng: number; radius_m: number; seq: number;
  planned_time: string | null; entered_at: string | null; exited_at: string | null;
}
export interface Rider {
  student_id: string; public_id: string; cred_version: number; name: string; class: string; stop_id: string | null;
  state: CustodyState; board_at: string | null; drop_at: string | null; photo: string | null;
  special_care: string | null; handover_required: boolean; is_guest: boolean;
}
export interface TripData {
  trip: {
    id: string; direction: Direction; status: string; route_code: string; route_name: string; trip_date: string;
    scheduled_start: string; started_at: string | null; arrived_at: string | null; departed_school_at: string | null;
    empty_bus_check: unknown; driver_id: string | null; attendant_id: string | null;
  };
  school: { name: string; lat: number | null; lng: number | null; radius_m: number; desk_phone: string | null } | null;
  stops: Stop[];
  manifest: Rider[];
  other_buses: { public_id: string; bus: string | null; name: string }[];
  server_ts: string;
}

export interface QueuedEvent {
  id: string;
  kind: "scan" | "resolve" | "arrive" | "depart_school" | "empty_check" | "complete" | "sos" | "delay";
  trip_id?: string | null;
  ts: string;
  lat?: number | null; lng?: number | null; acc?: number | null;
  crew_id?: string | null;
  data?: Record<string, unknown>;
}

export interface Fix { lat: number; lng: number; acc: number | null; speed: number | null; heading: number | null; ts: number }
