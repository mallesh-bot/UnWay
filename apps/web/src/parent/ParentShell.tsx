import { useEffect, useState, type ReactNode } from "react";
import { initialLang, saveLang, type Lang } from "./i18n";

export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(initialLang());
  const setLang = (l: Lang) => { setLangState(l); saveLang(l); document.documentElement.lang = l; };
  return [lang, setLang];
}

export function LangSwitch({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="neu-inset flex gap-0.5 rounded-xl p-1 text-sm" role="group" aria-label="Language">
      {(["en", "te", "hi"] as Lang[]).map((l) => (
        <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
          className={`rounded-lg px-2.5 py-0.5 font-semibold transition-all duration-300 ${lang === l ? "bg-panel text-ink shadow-[2px_2px_5px_var(--neu-dark),-2px_-2px_5px_var(--neu-light)]" : "text-ink-3 hover:text-ink"}`}>
          {{ en: "EN", te: "తె", hi: "हि" }[l]}
        </button>
      ))}
    </div>
  );
}

/** Mobile-first frame for every parent-facing page. */
export default function ParentShell({ lang, setLang, title, children }: { lang: Lang; setLang: (l: Lang) => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    document.documentElement.lang = lang;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="min-h-full bg-surface">
      <header className="sticky top-0 z-20 bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="plate" style={{ height: "1.9rem", minWidth: "2.2rem" }}>U</span>
            <span className="min-w-0">
              <span className="block font-display font-extrabold leading-tight">UnWay</span>
              {title && <span className="block truncate text-xs text-ink-3">{title}</span>}
            </span>
          </span>
          <LangSwitch lang={lang} setLang={setLang} />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-10 pt-4">{children}</main>
    </div>
  );
}
