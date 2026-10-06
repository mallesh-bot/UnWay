import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { toast } from "sonner";
import { ArrowLeft, Printer } from "lucide-react";
import { useAuth } from "../lib/auth";
import { check, rpc, supabase } from "../lib/supabase";
import { getCredentials, qrDataUrl } from "../lib/qr";
import type { Assignment, Route, Student } from "../lib/types";
import { Button, ErrorBox, PageHeader, Panel, Select } from "../components/ui";

const MM = 72 / 25.4;
const CARD_W = 85.6 * MM, CARD_H = 54 * MM;
const INK = rgb(0.118, 0.165, 0.196), BUS = rgb(0.949, 0.718, 0.02), GREY = rgb(0.42, 0.48, 0.52);

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.split(",")[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fit(text: string, font: PDFFont, size: number, max: number): string {
  // pdf-lib standard fonts only support WinAnsi; strip unsupported characters
  let t = text.replace(/[^\x20-\x7E -ÿ]/g, "");
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2) + "…";
  return t;
}

async function drawCard(doc: PDFDocument, page: PDFPage, x: number, y: number, s: Student, payload: string, school: string, phone: string, routeText: string, bold: PDFFont, reg: PDFFont) {
  // border
  page.drawRectangle({ x, y, width: CARD_W, height: CARD_H, borderColor: INK, borderWidth: 1, color: rgb(1, 1, 1) });
  // yellow band
  page.drawRectangle({ x, y: y + CARD_H - 11 * MM, width: CARD_W, height: 11 * MM, color: BUS });
  page.drawText(fit(school, bold, 9, CARD_W - 8 * MM), { x: x + 3.5 * MM, y: y + CARD_H - 6 * MM, size: 9, font: bold, color: INK });
  page.drawText("School transport card", { x: x + 3.5 * MM, y: y + CARD_H - 9.4 * MM, size: 6.5, font: reg, color: INK });

  // QR on the right
  const qr = await doc.embedPng(dataUrlBytes(await qrDataUrl(payload, 400)));
  const qs = 34 * MM;
  page.drawImage(qr, { x: x + CARD_W - qs - 3 * MM, y: y + 3.5 * MM, width: qs, height: qs });

  // photo
  let tx = x + 3.5 * MM;
  if (s.photo_thumb?.startsWith("data:image/jpeg")) {
    try {
      const img = await doc.embedJpg(dataUrlBytes(s.photo_thumb));
      page.drawImage(img, { x: tx, y: y + CARD_H - 30 * MM, width: 16 * MM, height: 16 * MM });
      tx += 18 * MM;
    } catch { /* ignore broken photo */ }
  }
  const textW = x + CARD_W - qs - 5 * MM - tx;
  page.drawText(fit(s.first_name, bold, 12, textW), { x: tx, y: y + CARD_H - 17.5 * MM, size: 12, font: bold, color: INK });
  page.drawText(fit(s.last_name, reg, 9, textW), { x: tx, y: y + CARD_H - 21.5 * MM, size: 9, font: reg, color: INK });
  const cls = [s.class_name, s.section].filter(Boolean).join("-");
  if (cls) page.drawText(`Class ${cls}`, { x: tx, y: y + CARD_H - 25.5 * MM, size: 8, font: reg, color: GREY });
  if (routeText) page.drawText(fit(routeText, bold, 8, CARD_W - qs - 8 * MM), { x: x + 3.5 * MM, y: y + 12 * MM, size: 8, font: bold, color: INK });
  page.drawText("If found, please call the school:", { x: x + 3.5 * MM, y: y + 7.5 * MM, size: 6, font: reg, color: GREY });
  page.drawText(fit(phone || "-", bold, 7.5, CARD_W - qs - 8 * MM), { x: x + 3.5 * MM, y: y + 4 * MM, size: 7.5, font: bold, color: INK });
}

export default function Cards() {
  const { org, campus } = useAuth();
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const [layout, setLayout] = useState<"a4" | "card">("a4");
  const [onlyNew, setOnlyNew] = useState(params.get("unprinted") === "1");
  const [students, setStudents] = useState<Student[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    (async () => {
      try {
        let q = supabase.from("students").select("*").eq("transport_status", "active").order("class_name").order("first_name");
        if (ids.length) q = q.in("id", ids);
        else if (onlyNew) q = q.is("card_printed_at", null);
        setStudents(check(await q) as Student[]);
      } catch (e) { setError(e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, onlyNew]);

  async function generate() {
    setBusy(true); setError(null);
    try {
      const creds = await getCredentials(students.map((s) => s.id));
      const credMap = Object.fromEntries(creds.map((c) => [c.student_id, c.payload]));
      const [{ data: asg }, { data: routes }] = await Promise.all([
        supabase.from("transport_assignments").select("*").in("student_id", students.map((s) => s.id)).is("effective_to", null),
        supabase.from("routes").select("id,code"),
      ]);
      const rmap = Object.fromEntries(((routes ?? []) as Route[]).map((r) => [r.id, r.code]));
      const routeText = (sid: string) => {
        const a = ((asg ?? []) as Assignment[]).filter((x) => x.student_id === sid);
        const am = a.find((x) => x.direction === "MORNING"), pm = a.find((x) => x.direction === "AFTERNOON");
        return [am && `AM ${rmap[am.route_id]}`, pm && `PM ${rmap[pm.route_id]}`].filter(Boolean).join("  ·  ");
      };

      const doc = await PDFDocument.create();
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      const reg = await doc.embedFont(StandardFonts.Helvetica);
      const phone = campus?.desk_phone ?? "";
      if (layout === "card") {
        for (const s of students) {
          const page = doc.addPage([CARD_W, CARD_H]);
          await drawCard(doc, page, 0, 0, s, credMap[s.id], org!.name, phone, routeText(s.id), bold, reg);
        }
      } else {
        const A4W = 210 * MM, A4H = 297 * MM, gap = 4 * MM;
        const left = (A4W - 2 * CARD_W - gap) / 2, top = A4H - 12 * MM;
        let page: PDFPage | null = null;
        for (let i = 0; i < students.length; i++) {
          const slot = i % 10;
          if (slot === 0) page = doc.addPage([A4W, A4H]);
          const col = slot % 2, row = Math.floor(slot / 2);
          await drawCard(doc, page!, left + col * (CARD_W + gap), top - (row + 1) * CARD_H - row * gap, students[i], credMap[students[i].id], org!.name, phone, routeText(students[i].id), bold, reg);
        }
      }
      const bytes = await doc.save();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      window.open(url, "_blank");
      await rpc("mark_cards_printed", { p_ids: students.map((s) => s.id) }).catch(() => {});
      toast.success("Cards ready. Print at 100% scale (no 'fit to page'). They're marked as printed.");
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <Link to="/students" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} /> Students</Link>
      <PageHeader title="Print QR cards" sub={ids.length ? `${students.length} selected students` : onlyNew ? `${students.length} students whose card isn't printed yet` : `All ${students.length} students using transport`} />
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="mb-1 block text-sm font-semibold text-ink-2">Layout</span>
            <Select value={layout} onChange={(e) => setLayout(e.target.value as "a4" | "card")}>
              <option value="a4">A4 sheet, 10 cards (cut & laminate)</option>
              <option value="card">One card per page (ID card printer, CR80)</option>
            </Select>
          </label>
          {!ids.length && (
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink-2">Which cards</span>
              <Select value={onlyNew ? "new" : "all"} onChange={(e) => setOnlyNew(e.target.value === "new")}>
                <option value="new">Only new and replaced cards</option>
                <option value="all">Every student</option>
              </Select>
            </label>
          )}
          <Button variant="primary" disabled={busy || !students.length} onClick={generate}><Printer size={16} /> {busy ? "Preparing…" : "Create PDF"}</Button>
        </div>
        <p className="mt-3 text-sm text-ink-3">Each card carries a signed code with no personal data. Laminate cards so they survive the monsoon. Lost a card? Use "Replace lost card" on the student page; the old one stops working.</p>
        <div className="mt-3"><ErrorBox error={error} /></div>
      </Panel>
    </div>
  );
}
