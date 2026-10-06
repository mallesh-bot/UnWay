import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Camera, MapPin } from "lucide-react";
import { geocode } from "../lib/planner";
import { useAuth } from "../lib/auth";
import { supabase, friendlyError } from "../lib/supabase";
import type { Student } from "../lib/types";
import { imageToThumb } from "../lib/format";
import { Avatar, Button, Drawer, ErrorBox, Field, Input, Select } from "./ui";

export default function StudentForm({ open, onClose, student, onSaved }: {
  open: boolean; onClose: () => void; student?: Student | null; onSaved?: (id: string) => void;
}) {
  const { org, campus } = useAuth();
  const [f, setF] = useState<Partial<Student>>({});
  const [guardian, setGuardian] = useState({ name: "", phone: "", relation: "Mother", language: "en" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setF(student ?? { transport_status: "active", handover_required: false });
    setGuardian({ name: "", phone: "", relation: "Mother", language: "en" });
    setError(null);
  }, [student, open]);

  const set = (k: keyof Student, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function onPhoto(file?: File) {
    if (!file) return;
    try { set("photo_thumb", await imageToThumb(file)); } catch { toast.error("Couldn't read that image"); }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const row = {
        org_id: org!.id, campus_id: f.campus_id ?? campus?.id ?? null,
        first_name: (f.first_name ?? "").trim(), last_name: (f.last_name ?? "").trim(),
        admission_no: f.admission_no?.trim() || null, class_name: f.class_name?.trim() || null, section: f.section?.trim() || null,
        dob: f.dob || null, gender: f.gender || null, photo_thumb: f.photo_thumb ?? null,
        special_care_note: f.special_care_note?.trim().slice(0, 60) || null, handover_required: !!f.handover_required,
        transport_status: f.transport_status ?? "active",
        home_address: f.home_address?.trim() || null, home_lat: f.home_lat ?? null, home_lng: f.home_lng ?? null,
      };
      let id = student?.id;
      if (id) {
        const { error } = await supabase.from("students").update(row).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("students").insert(row).select("id").single();
        if (error) throw error;
        id = data.id as string;
        if (guardian.phone.trim()) {
          let phone = guardian.phone.replace(/[^\d+]/g, "");
          if (!phone.startsWith("+")) phone = phone.length === 10 ? "+91" + phone : "+" + phone;
          const { data: existing } = await supabase.from("guardians").select("id").eq("phone", phone).maybeSingle();
          let gid = existing?.id as string | undefined;
          if (!gid) {
            const { data: g, error: ge } = await supabase.from("guardians").insert({
              org_id: org!.id, name: guardian.name.trim() || "Parent", phone, relation: guardian.relation, language: guardian.language,
            }).select("id").single();
            if (ge) throw ge;
            gid = g.id as string;
          }
          const { error: le } = await supabase.from("student_guardians").insert({ org_id: org!.id, student_id: id, guardian_id: gid, is_primary: true });
          if (le) throw le;
        }
      }
      toast.success(student ? "Student updated" : "Student added");
      onSaved?.(id!);
      onClose();
    } catch (err) {
      setError(new Error(friendlyError((err as Error).message)));
    } finally { setBusy(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} title={student ? "Edit student" : "Add student"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" form="student-form" disabled={busy}>{busy ? "Saving…" : "Save student"}</Button></>}>
      <form id="student-form" onSubmit={save} className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar src={f.photo_thumb} name={`${f.first_name ?? "?"} ${f.last_name ?? ""}`} size={72} />
          <div className="space-x-2">
            <Button type="button" size="sm" onClick={() => fileRef.current?.click()}><Camera size={15} /> {f.photo_thumb ? "Change photo" : "Add photo"}</Button>
            {f.photo_thumb && <Button type="button" size="sm" variant="ghost" onClick={() => set("photo_thumb", null)}>Remove</Button>}
            <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
            <p className="mt-1 text-xs text-ink-3">Shown to the bus attendant on every scan so they can check the face.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input required value={f.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></Field>
          <Field label="Last name"><Input value={f.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></Field>
          <Field label="Admission no."><Input value={f.admission_no ?? ""} onChange={(e) => set("admission_no", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Class"><Input value={f.class_name ?? ""} onChange={(e) => set("class_name", e.target.value)} /></Field>
            <Field label="Section"><Input value={f.section ?? ""} onChange={(e) => set("section", e.target.value)} /></Field>
          </div>
          <Field label="Date of birth"><Input type="date" value={f.dob ?? ""} onChange={(e) => set("dob", e.target.value)} /></Field>
          <Field label="Transport">
            <Select value={f.transport_status} onChange={(e) => set("transport_status", e.target.value)}>
              <option value="active">Uses school bus</option><option value="suspended">Paused</option>
              <option value="opted_out">Opted out</option><option value="left">Left school</option>
            </Select>
          </Field>
        </div>
        <Field label="Home address" hint={f.home_lat != null ? `On the map (${f.home_lat.toFixed(4)}, ${f.home_lng?.toFixed(4)}). Used by Auto-plan routes.` : "Used by Auto-plan routes to pick the nearest stop."}>
          <div className="flex gap-2">
            <Input value={f.home_address ?? ""} onChange={(e) => { set("home_address", e.target.value); set("home_lat", null); set("home_lng", null); }} placeholder="House, street, area, city" />
            <Button type="button" disabled={!f.home_address?.trim()} onClick={async () => {
              const p = await geocode(f.home_address!, campus?.lat ? [campus.lat, campus.lng!] : undefined).catch(() => null);
              if (p) { set("home_lat", p[0]); set("home_lng", p[1]); toast.success("Found on the map"); } else toast.error("Couldn't find that address. Try adding the area and city.");
            }}><MapPin size={15} /> Find</Button>
          </div>
        </Field>
        <Field label="Special care note (crew can see this)" hint="Max 60 characters, e.g. 'Asthma – inhaler in bag'.">
          <Input maxLength={60} value={f.special_care_note ?? ""} onChange={(e) => set("special_care_note", e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" className="h-4 w-4" checked={!!f.handover_required} onChange={(e) => set("handover_required", e.target.checked)} />
          Hand over only to a guardian at drop-off (young children)
        </label>

        {!student && (
          <fieldset className="space-y-3 neu-inset rounded-2xl p-4">
            <legend className="px-1 text-sm font-bold">Parent / guardian</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><Input value={guardian.name} onChange={(e) => setGuardian({ ...guardian, name: e.target.value })} /></Field>
              <Field label="Mobile (WhatsApp)"><Input inputMode="tel" placeholder="98765 43210" value={guardian.phone} onChange={(e) => setGuardian({ ...guardian, phone: e.target.value })} /></Field>
              <Field label="Relation">
                <Select value={guardian.relation} onChange={(e) => setGuardian({ ...guardian, relation: e.target.value })}>
                  {["Mother", "Father", "Guardian", "Grandparent", "Other"].map((r) => <option key={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="Message language">
                <Select value={guardian.language} onChange={(e) => setGuardian({ ...guardian, language: e.target.value })}>
                  <option value="en">English</option><option value="hi">Hindi</option><option value="te">Telugu</option>
                </Select>
              </Field>
            </div>
            <p className="text-xs text-ink-3">You can add more guardians and set bus routes after saving.</p>
          </fieldset>
        )}
        <ErrorBox error={error} />
      </form>
    </Drawer>
  );
}
