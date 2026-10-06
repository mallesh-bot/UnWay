import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { joinInfo, type JoinInfo } from "./api";
import { tr } from "./i18n";
import ParentShell, { useLang } from "./ParentShell";

/** Invite links (/join/CODE) open the parent's own page. */
export default function JoinPage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const [lang, setLang] = useLang();
  const [info, setInfo] = useState<JoinInfo | null>(null);

  useEffect(() => {
    joinInfo(code).then((i) => {
      if (i.ok && i.portal_token) {
        const stored = (() => { try { return localStorage.getItem("unway-lang"); } catch { return null; } })();
        if (!stored && (i.language === "hi" || i.language === "te")) setLang(i.language);
        nav(`/p/${i.portal_token}?welcome=1`, { replace: true });
      } else setInfo(i);
    }).catch(() => setInfo({ ok: false } as JoinInfo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <ParentShell lang={lang} setLang={setLang}>
      {!info ? <p className="py-16 text-center text-ink-3">{tr(lang, "loading")}</p> : (
        <div className="py-16 text-center">
          <h1 className="text-xl font-extrabold">{tr(lang, "badCode")}</h1>
          <p className="mt-2 text-ink-3">{tr(lang, "badCodeSub")}</p>
        </div>
      )}
    </ParentShell>
  );
}
