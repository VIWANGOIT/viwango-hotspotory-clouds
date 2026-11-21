"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createBrowserSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      setBusy(false);
      return;
    }

    router.replace(params.get("next") ?? "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-md p-8">
      <h1 className="font-display text-2xl font-semibold text-white">Sign in</h1>
      <p className="mt-1 text-sm text-white/50">Administrator access to the hotspot cloud.</p>

      <div className="mt-6 space-y-4">
        <div>
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="field"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            className="field"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 w-full rounded-xl bg-brand px-4 py-3 font-semibold text-ink transition hover:bg-brand/90 disabled:opacity-60"
      >
        {busy ? "Signing in..." : "Sign in"}
      </button>

      <p className="mt-6 text-xs leading-relaxed text-white/40">
        No account yet? Create the first administrator with{" "}
        <code className="rounded bg-white/10 px-1 py-0.5 text-white/70">npm run create-admin -- you@example.com</code>.
      </p>
      <Link href="/" className="mt-4 inline-block text-xs text-white/40 hover:text-white/70">
        ← Back to home
      </Link>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <Suspense fallback={<div className="card w-full max-w-md p-8 text-sm text-white/50">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
