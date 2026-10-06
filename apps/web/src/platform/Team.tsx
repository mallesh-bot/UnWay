import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { rpc } from "../lib/supabase";
import { Button, Field, Input, PageHeader, Panel } from "../components/ui";
import type { HealthInfo } from "./types";

export default function Team() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const h = useQuery({ queryKey: ["platform-health"], queryFn: () => rpc<HealthInfo>("platform_health") });
  const [email, setEmail] = useState("");
  async function set(e: string, add: boolean) {
    try { await rpc("platform_set_admin", { p_email: e, p_add: add }); toast.success(add ? `${e} added` : `${e} removed`); setEmail(""); qc.invalidateQueries({ queryKey: ["platform-health"] }); }
    catch (err) { toast.error((err as Error).message); }
  }
  const me = session?.user.email?.toLowerCase();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="UnWay console" title="UnWay team" sub="People who can open this console. They sign in on the normal login page with this email." />
      <Panel title="Team members" padded={false}>
        <ul className="divide-y divide-line-2">
          {(h.data?.platform_admins ?? []).map((e) => (
            <li key={e} className="flex items-center justify-between px-5 py-3">
              <span className="font-semibold">{e} {e === me && <span className="text-sm font-normal text-ink-3">(you)</span>}</span>
              {e !== me && <Button size="sm" variant="ghost" onClick={() => confirm(`Remove ${e}?`) && set(e, false)}>Remove</Button>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2 border-t border-line-2 p-5">
          <Field label="Add by email" className="min-w-64 flex-1"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button variant="primary" disabled={!email.includes("@")} onClick={() => set(email, true)}>Add</Button>
        </div>
      </Panel>
      <p className="text-sm text-ink-3">Tip: use a separate email for your own test school. An account that belongs to a school can't open other schools from the console.</p>
    </div>
  );
}
