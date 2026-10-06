// Renders replies to parent commands (STATUS / ABSENT / HELP / STOP / START)
import { lang, Lang, stateText, t } from "./messages.ts";

// deno-lint-ignore no-explicit-any
export function renderCommandReply(result: any): string {
  const l: Lang = lang(result?.language);
  if (!result?.ok) return t(l, "UNKNOWN");
  const lines: string[] = [];
  for (const it of result.items ?? []) {
    switch (it.type) {
      case "stopped": lines.push(t(l, "STOPPED")); break;
      case "started":
        lines.push(t(l, "STARTED"));
        if (it.portal_url) lines.push(t(l, "PORTAL", { url: it.portal_url }));
        break;
      case "portal": if (it.portal_url) lines.push(t(l, "PORTAL", { url: it.portal_url })); break;
      case "help": lines.push(t(l, "HELP", { desk_phone: it.desk_phone ?? "" })); break;
      case "absent": {
        const isToday = it.date === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        lines.push(t(l, "ABSENT", { child: it.child, when: t(l, isToday ? "today" : "tomorrow"), legs: it.legs }));
        break;
      }
      case "status": {
        if (!it.state || it.state === "NO_TRIP") { lines.push(t(l, "STATUS_NONE", { child: it.child })); break; }
        let line = t(l, "STATUS", { child: it.child, state_text: stateText(l, it.state), bus: it.bus ?? "" });
        const when = it.state === "ON_BOARD" ? it.board_at : it.state === "DROPPED" ? it.drop_at : null;
        if (when) line += ` · ${when}`;
        if (it.track_token && it.track_base_url) line += `\n${t(l, "TRACK", { url: `${String(it.track_base_url).replace(/\/$/, "")}/t/${it.track_token}` })}`;
        lines.push(line);
        break;
      }
    }
  }
  return [...new Set(lines)].join("\n\n") || t(l, "HELP", {});
}
