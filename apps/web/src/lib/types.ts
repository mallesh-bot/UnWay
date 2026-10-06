export type Direction = "MORNING" | "AFTERNOON";
export type Role = "school_admin" | "transport_manager" | "viewer";
export type CustodyState =
  | "EXPECTED" | "ABSENT_NOTIFIED" | "ON_BOARD" | "DROPPED" | "MISSED" | "NO_SHOW"
  | "HANDED_OVER" | "UNCONFIRMED" | "TRANSFERRED";

export interface Organization {
  id: string; name: string; short_code: string; timezone: string; logo_url: string | null;
  settings: Record<string, unknown>; staff_join_code: string;
  status?: "trial" | "active" | "suspended"; plan?: string;
}
export interface Campus {
  id: string; org_id: string; name: string; address: string | null; lat: number | null; lng: number | null;
  geofence_radius_m: number; desk_phone: string | null;
}
export interface OrgUser { user_id: string; org_id: string; role: Role; name: string | null; email: string | null }

export interface Student {
  id: string; org_id: string; campus_id: string | null; public_id: string; cred_version: number;
  admission_no: string | null; first_name: string; last_name: string; class_name: string | null; section: string | null;
  dob: string | null; gender: string | null; photo_thumb: string | null; special_care_note: string | null;
  handover_required: boolean; transport_status: "active" | "suspended" | "opted_out" | "left"; created_at: string;
  home_lat?: number | null; home_lng?: number | null; home_address?: string | null; card_printed_at?: string | null;
}
export interface Guardian {
  id: string; org_id: string; name: string; relation: string | null; phone: string | null; email: string | null;
  language: "en" | "hi" | "te"; invite_code: string; portal_token?: string;
}
export interface GuardianChannel {
  id: string; guardian_id: string; channel: "whatsapp" | "telegram" | "webpush" | "email"; address: string;
  status: "pending" | "active" | "stopped" | "failed"; verified_at: string | null;
}
export interface Bus {
  id: string; org_id: string; display_number: string; registration_no: string | null; capacity: number;
  status: "active" | "maintenance" | "retired"; notes: string | null;
}
export interface Crew {
  id: string; org_id: string; name: string; role: "driver" | "attendant"; phone: string | null;
  licence_no: string | null; licence_valid_until: string | null; medical_check_date: string | null; active: boolean;
}
export interface Device {
  id: string; bus_id: string; model: string | null; app_version: string | null; paired_at: string;
  last_seen_at: string | null; battery: number | null; revoked_at: string | null;
}
export interface Stop {
  id: string; org_id: string; name: string; landmark: string | null; lat: number; lng: number; radius_m: number;
}
export interface Route {
  id: string; org_id: string; code: string; name: string; direction: Direction; default_bus_id: string | null;
  days_mask: number; scheduled_start: string; active: boolean; campus_id: string | null; auto_planned?: boolean;
}
export interface RouteStop { route_id: string; stop_id: string; seq: number; planned_offset_min: number }
export interface Assignment {
  id: string; student_id: string; direction: Direction; route_id: string; stop_id: string;
  effective_from: string; effective_to: string | null;
}
export interface Trip {
  id: string; org_id: string; route_id: string; bus_id: string | null; trip_date: string; direction: Direction;
  status: "scheduled" | "active" | "completed" | "completed_forced" | "cancelled" | "aborted_auto";
  scheduled_start: string; started_at: string | null; arrived_at: string | null; departed_school_at: string | null;
  completed_at: string | null; driver_id: string | null; attendant_id: string | null;
  empty_bus_check: Record<string, unknown> | null; completion_reason: string | null;
}
export interface ManifestRow {
  trip_id: string; student_id: string; stop_id: string | null; state: CustodyState; state_at: string;
  board_at: string | null; drop_at: string | null; resolved_reason: string | null; is_guest: boolean;
}
export interface ScanEvent {
  id: string; trip_id: string; student_id: string | null; type: "BOARD" | "DEBOARD" | null; method: string;
  result: string; device_ts: string | null; server_ts: string; lat: number | null; lng: number | null;
  stop_id: string | null; reason: string | null;
}
export interface ExceptionRow {
  id: string; org_id: string; trip_id: string | null; student_id: string | null; bus_id: string | null; code: string;
  severity: "info" | "low" | "medium" | "high" | "critical"; status: "open" | "acknowledged" | "resolved";
  message: string | null; data: Record<string, unknown>; opened_at: string; acknowledged_at: string | null;
  resolved_at: string | null; resolution_note: string | null;
}
export interface Incident {
  id: string; org_id: string; trip_id: string | null; bus_id: string | null; type: string; severity: string;
  status: "open" | "acknowledged" | "resolved"; lat: number | null; lng: number | null; note: string | null;
  data: Record<string, unknown>; created_at: string; resolution_note: string | null;
}

export interface LiveTrip {
  id: string; direction: Direction; status: Trip["status"]; route_code: string; route_name: string;
  scheduled_start: string; started_at: string | null; completed_at: string | null; driver: string | null; attendant: string | null;
  expected: number; on_board: number; dropped: number; missing: number; waiting: number; stops_done: number; stops_total: number;
}
export interface LiveBus {
  bus_id: string; display_number: string; registration_no: string | null; status: string;
  live: { lat: number | null; lng: number | null; heading: number | null; speed_kmh: number | null; battery: number | null; updated_at: string; trip_id: string | null } | null;
  device: { id: string; last_seen_at: string | null; battery: number | null; app_version: string | null } | null;
  trips: LiveTrip[];
}
export interface LiveBoard {
  today: string; server_ts: string;
  kpi: { active_trips: number; scheduled_trips: number; late_trips: number; on_board: number; not_boarded: number;
         open_exceptions: number; open_incidents: number; offline_buses: number };
  buses: LiveBus[];
}
