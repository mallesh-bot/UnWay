import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { Button, ErrorBox, Field, Input } from "../components/ui";
import { Logo } from "../components/Shell";
import { ArrowLeft } from "lucide-react";
import { rememberedPortal } from "../parent/api";

export default function Login() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup" | "magic">(params.get("signup") ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const portal = rememberedPortal();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) toast.success("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: false } });
        if (error) throw error;
        toast.success("Sign-in link sent. Check your email.");
      }
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <div className="relative grid min-h-full place-items-center overflow-hidden bg-surface px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full shadow-[30px_30px_70px_var(--neu-dark),-30px_-30px_70px_var(--neu-light)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[380px] w-[380px] rounded-full shadow-[inset_24px_24px_50px_var(--neu-dark),inset_-24px_-24px_50px_var(--neu-light)]" />
      <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-[440px] rounded-[36px] bg-panel p-8 shadow-[var(--shadow-pop)] sm:p-10">
        <Link to="/" className="mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} /> UnWay home</Link>
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="rounded-[14px] shadow-[var(--shadow-soft)]"><Logo size={46} /></span>
            <div>
              <h1 className="font-display text-[28px] font-extrabold leading-tight">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
              <p className="text-ink-3">{mode === "signup" ? "You'll set up your school next." : "For school staff and the UnWay team."}</p>
            </div>
          </div>
          <Field label="Email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {mode !== "magic" && (
            <Field label="Password"><Input type="password" required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          )}
          <ErrorBox error={error} />
          <Button variant="bus" className="h-12 w-full font-display text-base" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a sign-in link"}
          </Button>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            {mode !== "signin" && <button type="button" className="font-semibold text-route" onClick={() => setMode("signin")}>Sign in with password</button>}
            {mode !== "magic" && <button type="button" className="font-semibold text-route" onClick={() => setMode("magic")}>Email me a link instead</button>}
            {mode !== "signup" && <button type="button" className="font-semibold text-route" onClick={() => setMode("signup")}>New school? Create account</button>}
          </div>
          {portal && (
            <a href={`/p/${portal}`} className="neu-inset block rounded-2xl p-4 text-sm">
              <b>Are you a parent?</b> <span className="text-route">Open your child's bus page</span>
            </a>
          )}
        </form>
      </motion.div>
    </div>
  );
}
