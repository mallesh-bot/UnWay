import QRCode from "qrcode";
import { rpc } from "./supabase";

export interface Credential { student_id: string; payload: string; version: number }

export async function getCredentials(ids: string[], reissue = false): Promise<Credential[]> {
  return rpc<Credential[]>("issue_credentials", { p_student_ids: ids, p_reissue: reissue });
}

export function qrDataUrl(text: string, size = 320): Promise<string> {
  return QRCode.toDataURL(text, { errorCorrectionLevel: "Q", margin: 1, width: size, color: { dark: "#1E2A32", light: "#FFFFFF" } });
}
