import { useQuery } from "@tanstack/react-query";
import { check, supabase } from "./supabase";
import type { Bus, Crew, Route, RouteStop, Stop, Student } from "./types";

export function useBuses() {
  return useQuery({
    queryKey: ["buses"],
    queryFn: async () => check(await supabase.from("buses").select("*").order("display_number")) as Bus[],
  });
}
export function useCrew() {
  return useQuery({
    queryKey: ["crew"],
    queryFn: async () => check(await supabase.from("crew_members").select("id,org_id,name,role,phone,licence_no,licence_valid_until,medical_check_date,active,created_at").order("name")) as Crew[],
  });
}
export function useStops() {
  return useQuery({
    queryKey: ["stops"],
    queryFn: async () => check(await supabase.from("stops").select("*").order("name")) as Stop[],
  });
}
export function useRoutes() {
  return useQuery({
    queryKey: ["routes"],
    queryFn: async () => check(await supabase.from("routes").select("*").order("code")) as Route[],
  });
}
export function useRouteStops() {
  return useQuery({
    queryKey: ["route_stops"],
    queryFn: async () => check(await supabase.from("route_stops").select("*").order("seq")) as RouteStop[],
  });
}
export function useStudentsLite() {
  return useQuery({
    queryKey: ["students-lite"],
    queryFn: async () => check(await supabase.from("students").select("id,first_name,last_name,class_name,section,admission_no,photo_thumb,transport_status").order("first_name").limit(5000)) as Pick<Student, "id" | "first_name" | "last_name" | "class_name" | "section" | "admission_no" | "photo_thumb" | "transport_status">[],
  });
}

export function byId<T extends { id: string }>(rows: T[] | undefined): Record<string, T> {
  const m: Record<string, T> = {};
  for (const r of rows ?? []) m[r.id] = r;
  return m;
}
