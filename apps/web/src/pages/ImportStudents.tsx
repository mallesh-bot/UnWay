import { useState } from "react";
import { Link } from "react-router-dom";
import Papa from "papaparse";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Download, Upload } from "lucide-react";
import { rpc } from "../lib/supabase";
import { downloadCsv } from "../lib/format";
import { Button, ErrorBox, PageHeader, Panel, Table, Td } from "../components/ui";

const COLUMNS = [
  "admission_no", "first_name", "last_name", "class", "section", "guardian_name", "guardian_phone",
  "guardian_relation", "guardian_language", "am_route", "am_stop", "pm_route", "pm_stop", "special_care",
  "home_address", "home_lat", "home_lng",
];

const ALIASES: Record<string, string> = {
  "admission number": "admission_no", "admission no": "admission_no", "adm no": "admission_no", "first name": "first_name",
  "last name": "last_name", "surname": "last_name", "parent name": "guardian_name", "parent phone": "guardian_phone",
  "mobile": "guardian_phone", "phone": "guardian_phone", "morning route": "am_route", "pickup stop": "am_stop",
  "afternoon route": "pm_route", "drop stop": "pm_stop", "language": "guardian_language", "relation": "guardian_relation",
  "address": "home_address", "home address": "home_address", "residential address": "home_address",
  "latitude": "home_lat", "lat": "home_lat", "longitude": "home_lng", "lng": "home_lng", "lon": "home_lng",
};

function normalizeHeader(h: string): string {
  const k = h.trim().toLowerCase().replace(/[_-]+/g, " ");
  return ALIASES[k] ?? k.replace(/\s+/g, "_");
}

interface Result { inserted: number; updated: number; errors: { row: number; error: string }[] }

export default function ImportStudents() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);

  function onFile(file?: File) {
    if (!file) return;
    setFileName(file.name); setResult(null); setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true, transformHeader: normalizeHeader,
      complete: (res) => {
        if (!res.data.length) { setError(new Error("The file has no rows.")); return; }
        if (!("first_name" in res.data[0])) { setError(new Error("Couldn't find a 'first_name' column. Download the template to see the expected columns.")); return; }
        setRows(res.data);
      },
      error: (err) => setError(err),
    });
  }

  async function runImport() {
    setBusy(true); setError(null);
    try {
      const out: Result = { inserted: 0, updated: 0, errors: [] };
      for (let i = 0; i < rows.length; i += 300) {
        const r = await rpc<Result>("import_students", { p_rows: rows.slice(i, i + 300) });
        out.inserted += r.inserted; out.updated += r.updated;
        out.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i })));
      }
      // home locations (used by Auto-plan routes)
      const homes = rows.filter((r) => r.admission_no && (r.home_address || (r.home_lat && r.home_lng)))
        .map((r) => ({ admission_no: r.admission_no, home_address: r.home_address ?? "", home_lat: r.home_lat ?? "", home_lng: r.home_lng ?? "" }));
      for (let i = 0; i < homes.length; i += 500) await rpc("set_student_homes", { p_rows: homes.slice(i, i + 500) });
      setResult(out);
      toast.success(`Imported: ${out.inserted} new, ${out.updated} updated${homes.length ? ` · ${homes.length} home addresses` : ""}`);
      qc.invalidateQueries();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  function template() {
    downloadCsv("unway-students-template.csv", [
      { admission_no: "A1001", first_name: "Aarav", last_name: "Reddy", class: "3", section: "B", guardian_name: "Kiran Reddy", guardian_phone: "9876543210", guardian_relation: "Father", guardian_language: "te", am_route: "R1", am_stop: "Sai Nagar", pm_route: "R1-PM", pm_stop: "Sai Nagar", special_care: "", home_address: "Plot 12, Sai Nagar, Kukatpally, Hyderabad", home_lat: "", home_lng: "" },
      { admission_no: "A1002", first_name: "Diya", last_name: "Sharma", class: "5", section: "A", guardian_name: "Neha Sharma", guardian_phone: "9876500001", guardian_relation: "Mother", guardian_language: "hi", am_route: "", am_stop: "", pm_route: "", pm_stop: "", special_care: "", home_address: "Flat 4B, Green Meadows, Miyapur, Hyderabad", home_lat: "", home_lng: "" },
    ]);
  }

  return (
    <div className="space-y-5">
      <Link to="/students" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} /> Students</Link>
      <PageHeader title="Import students" sub="Upload a CSV exported from your school records or Excel (File → Save as → CSV)."
        actions={<Button onClick={template}><Download size={16} /> Download template</Button>} />
      <Panel>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-ink-2">
          <li>Create routes and stops first if you want students assigned automatically (route code + stop name must match).</li>
          <li>Students are matched by admission number. Re-importing updates them instead of making duplicates.</li>
          <li>Phone numbers without a country code are treated as Indian (+91). Parents with the same phone are shared by siblings.</li>
        </ol>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-6 py-10 text-center hover:border-route">
          <Upload className="text-ink-3" />
          <span className="font-semibold">{fileName || "Choose a CSV file"}</span>
          <span className="text-sm text-ink-3">Columns: {COLUMNS.join(", ")}</span>
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <div className="mt-3"><ErrorBox error={error} /></div>
      </Panel>

      {rows.length > 0 && !result && (
        <Panel title={`Preview (${rows.length} rows)`} actions={<Button variant="primary" disabled={busy} onClick={runImport}>{busy ? "Importing…" : `Import ${rows.length} students`}</Button>} padded={false}>
          <Table head={["#", "Admission", "Name", "Class", "Guardian", "Phone", "Morning", "Afternoon"]}>
            {rows.slice(0, 50).map((r, i) => (
              <tr key={i}>
                <Td className="text-ink-3">{i + 1}</Td><Td>{r.admission_no}</Td><Td className="font-semibold">{r.first_name} {r.last_name}</Td>
                <Td>{[r.class, r.section].filter(Boolean).join("-")}</Td><Td>{r.guardian_name}</Td><Td>{r.guardian_phone}</Td>
                <Td>{r.am_route} {r.am_stop && `· ${r.am_stop}`}</Td><Td>{r.pm_route} {r.pm_stop && `· ${r.pm_stop}`}</Td>
              </tr>
            ))}
          </Table>
          {rows.length > 50 && <p className="px-4 py-2 text-sm text-ink-3">…and {rows.length - 50} more</p>}
        </Panel>
      )}

      {result && (
        <Panel title="Import finished">
          <p><b>{result.inserted}</b> added, <b>{result.updated}</b> updated, <b className={result.errors.length ? "text-alert" : ""}>{result.errors.length}</b> rows with problems.</p>
          {result.errors.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {result.errors.map((e) => <li key={e.row} className="text-alert">Row {e.row}: {e.error}</li>)}
            </ul>
          )}
          <div className="mt-4 flex gap-2"><Link to="/students"><Button variant="primary">Go to students</Button></Link><Button onClick={() => { setRows([]); setResult(null); setFileName(""); }}>Import another file</Button></div>
        </Panel>
      )}
    </div>
  );
}
