# AGENTS.md

Repository memory for agents working on VIWANGO Hotspot Cloud.

## What this is

Cloud version of the VIWANGO hotspot system: Next.js 15 App Router on Vercel, Supabase PostgreSQL, and a hand written
MikroTik RouterOS API client. It must stay independent from the operator's VPS installation: never copy production
credentials here, never assume a shared database, never write to the VPS.

## Commands

```bash
npm run dev            # local dev server
npm run build          # production build (must pass before pushing)
npm run typecheck      # tsc --noEmit
npm test               # vitest, includes a real TCP RouterOS test double
npm run db:migrate     # apply supabase/migrations via Management API
npm run db:seed        # packages + portal settings
npm run create-admin -- email 'password'
npx tsx scripts/dev-fake-router.ts --port 8728 --mode plain|legacy
```

`db:migrate` / `db:seed` need `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` in the environment; other values come
from `.env.local`, which is gitignored.

## Critical invariants

1. **Secrets never enter git.** Only `.env.example` is tracked. Router passwords are encrypted with AES-256-GCM
   (`src/lib/crypto.ts`) before storage.
2. **RouterOS replies are not framed per command.** All exchanges go through the serial queue in
   `RouterOsClient.talkRaw`. Do not pipeline commands, and do not bypass the queue.
3. **Drain buffered replies.** `readSentence` must call `drain()` after registering a waiter, otherwise a reply that
   arrived early sits in the buffer until timeout.
4. **Handshake negotiation is intentional.** Try plain login first, fall back to the legacy MD5 challenge only when the
   router returns `=ret=`. The legacy digest is `md5(0x00 + password + challenge)` hex with a `00` prefix.
5. **Acceptance before trust.** A router is `online` only after `verifyRouterAcceptance` proves TCP, login and identity.
   Warnings (license, hotspot server, API restriction, clock) do not block acceptance but must be surfaced.
6. **Voucher time is protected.** `activate_voucher` is atomic; if provisioning fails for a newly activated voucher,
   roll it back to `unused` (see `src/app/api/portal/activate/route.ts`).
7. **RLS everywhere.** Admin reads use the cookie-bound client or the service role on the server only. The service role
   key must never be imported into a `"use client"` module.

## Layout

- `src/lib/mikrotik/protocol.ts` — length prefix codec, sentence encoder/decoder
- `src/lib/mikrotik/client.ts` — socket, login negotiation, command queue, error mapping
- `src/lib/mikrotik/hotspot.ts` — hotspot servers, users, profiles, active sessions
- `src/lib/routers/verify.ts` — acceptance checklist
- `src/lib/routers/service.ts` — health persistence, events, heartbeat, session sync
- `src/lib/provisioning.ts` — package → RouterOS profile/user mapping
- `supabase/migrations/*.sql` — append only; never edit an applied migration
- `tests/helpers/fake-router.ts` — RouterOS test double used by the whole suite

## Conventions

- TypeScript strict, `@/*` path alias, no default exports except pages/components.
- API responses are `{ ok: true, data }` or `{ ok: false, error, details }` via `src/lib/http.ts`.
- Every mutating route calls `requireAdmin()`; cron routes call `requireCronSecret()`.
- Validation lives in `src/lib/validation.ts` (zod).
- UI copy is English; the customer portal and README include Swahili where it helps the operator.
- New protocol behaviour needs a test in `tests/` using `FakeRouter`, not a mock.
