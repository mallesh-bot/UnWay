import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { rpc } from "../lib/supabase";
import { Button, ErrorBox, Field, Input } from "../components/ui";
import MapView from "../components/MapView";

export default function Onboarding() {
  const { refresh, signOut, session } = useAuth();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [campus, setCampus] = useState("");
  const [you, setYou] = useState("");
  const [phone, setPhone] = useState("");
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pos) { setError(new Error("Click the map to mark your school's location.")); return; }
    setBusy(true); setError(null);
    try {
      await rpc("create_organization", { p_name: name, p_short_code: code, p_campus_name: campus || name, p_lat: pos[0], p_lng: pos[1], p_user_name: you, p_desk_phone: phone || null });
      toast.success("School created");
      await refresh();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <h1 className="text-3xl font-extrabold">Set up your school</h1>
      <p className="mt-1 text-ink-3">Signed in as {session?.user.email}. If your school already uses UnWay, ask your admin to invite you instead. <button className="font-semibold text-route" onClick={signOut}>Sign out</button></p>
      <form onSubmit={submit} className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="School name"><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunrise Public School" /></Field>
          <Field label="Short code" hint="3–6 letters/numbers. Printed inside QR cards; can't be changed later.">
            <Input required pattern="[A-Za-z0-9]{3,6}" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SPS" />
          </Field>
          <Field label="Campus name (optional)"><Input value={campus} onChange={(e) => setCampus(e.target.value)} placeholder="Main campus" /></Field>
          <Field label="Transport desk phone" hint="Shown to parents in alerts."><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 40 1234 5678" /></Field>
          <Field label="Your name"><Input value={you} onChange={(e) => setYou(e.target.value)} /></Field>
          <ErrorBox error={error} />
          <Button variant="primary" disabled={busy}>{busy ? "Creating…" : "Create school"}</Button>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-ink-2">School location {pos ? `(${pos[0].toFixed(5)}, ${pos[1].toFixed(5)})` : "(click the map)"}</p>
          <MapView className="h-[420px] w-full rounded-[22px] neu" zoom={11} center={[17.385, 78.4867]}
            markers={pos ? [{ id: "school", kind: "school", lat: pos[0], lng: pos[1], draggable: true }] : []}
            circles={pos ? [{ lat: pos[0], lng: pos[1], radius: 150 }] : []}
            onMapClick={(lat, lng) => setPos([lat, lng])} onMarkerDrag={(_, lat, lng) => setPos([lat, lng])} />
          <Button type="button" size="sm" className="mt-2" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setPos([p.coords.latitude, p.coords.longitude]))}>
            Use my current location
          </Button>
        </div>
      </form>
    </div>
  );
}
