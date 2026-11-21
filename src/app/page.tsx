import Link from "next/link";

const features = [
  {
    title: "Handshake that works",
    body: "Plain login for RouterOS 6.43+ with automatic fallback to the legacy MD5 challenge. No more 'cannot log in' on old boards.",
  },
  {
    title: "Router acceptance, not guessing",
    body: "Every router is proven reachable, authenticated, licensed for hotspot, and checked for API restrictions before it goes live.",
  },
  {
    title: "Vouchers that land on the device",
    body: "Generate a batch in the cloud, push the hotspot users to the router, and let customers log in from the captive portal.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-lg font-bold text-ink">V</span>
          <div>
            <p className="font-display text-sm font-semibold tracking-[0.2em] text-white/80">VIWANGO</p>
            <p className="text-xs text-white/45">Hotspot Cloud</p>
          </div>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/portal" className="rounded-lg px-3 py-2 text-white/70 transition hover:bg-white/5 hover:text-white">
            Customer portal
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg bg-brand px-4 py-2 font-semibold text-ink transition hover:bg-brand/90"
          >
            Open dashboard
          </Link>
        </nav>
      </header>

      <section className="flex flex-1 flex-col justify-center py-16">
        <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Cloud version — fully separate from the VPS install
        </p>
        <h1 className="max-w-3xl font-display text-4xl leading-tight font-semibold text-white sm:text-6xl">
          Hotspot control that actually talks to your MikroTik.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-white/60">
          VIWANGO Hotspot Cloud runs on Vercel and Supabase. Routers, packages, vouchers and sessions live in one
          place, and every connection is verified end to end before a customer ever sees a code.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/dashboard" className="rounded-xl bg-brand px-6 py-3 font-semibold text-ink transition hover:bg-brand/90">
            Go to dashboard
          </Link>
          <Link
            href="/portal"
            className="rounded-xl border border-white/15 px-6 py-3 font-semibold text-white/80 transition hover:border-white/30 hover:text-white"
          >
            Try the customer portal
          </Link>
        </div>
      </section>

      <section className="grid gap-4 pb-16 sm:grid-cols-3">
        {features.map((feature) => (
          <article key={feature.title} className="card p-6">
            <h2 className="font-display text-base font-semibold text-white">{feature.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/55">{feature.body}</p>
          </article>
        ))}
      </section>

      <footer className="border-t border-white/10 py-6 text-xs text-white/35">
        VIWANGO Hotspot Cloud · Next.js on Vercel · Supabase PostgreSQL · MikroTik RouterOS API
      </footer>
    </main>
  );
}
