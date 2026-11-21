"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createBrowserSupabaseClient().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/25 hover:text-white disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
