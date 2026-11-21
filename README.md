# VIWANGO Hotspot Cloud

Cloud control plane for MikroTik hotspot networks: routers, packages, vouchers, live sessions and a customer
captive portal. This repository is the **completely separate cloud version**. It shares no files, no database and no
credentials with the VPS installation, so the production system is never touched.

Stack: Next.js 15 (App Router) on Vercel, Supabase PostgreSQL with row level security, and a hand written
MikroTik RouterOS API client.

---

## What is fixed in this version

### 1. The MikroTik login handshake

RouterOS changed its API login in 6.43. Older code sends the MD5 challenge response to every router; newer code sends
plain credentials to every router. Both fail on half the devices in the field.

The client in `src/lib/mikrotik/client.ts` negotiates instead:

| Router | First attempt | Result |
| --- | --- | --- |
| RouterOS 6.43+ | `/login` with `=name=` and `=password=` | `!done` with no `ret` → **plain** |
| RouterOS < 6.43 | `/login` with `=name=` and `=password=` | `!done` with `=ret=<challenge>` → **legacy MD5** |
| RouterOS < 6.43 | `/login` with `=name=` and `=response=00<md5>` | `!done` |

The legacy response is exactly `md5(0x00 + password + challenge_bytes)` in hex, prefixed with `00`, sent together with
`=name=`. The mode that worked is stored per router, and the API reports it as `plain` or `legacy-md5`.

Three further problems that cause "handshake hangs" are also handled:

- **Length prefix encoding** follows the RouterOS 1–5 byte scheme (`<0x80`, `<0x4000`, `<0x200000`, `<0x10000000`,
  otherwise `0xF0` + uint32). A wrong prefix makes the router wait forever.
- **Replies are not framed per command.** A `!done` belongs to whichever command was sent last, so commands are
  serialised through an internal queue instead of being pipelined.
- **Buffered replies are drained.** If the router's reply is already in the socket buffer when a reader registers, the
  reader now consumes it immediately instead of waiting for the timeout.

### 2. Router acceptance

A router is only trusted after `POST /api/routers` (or "Run acceptance check") proves each step:

| Step | Passes when |
| --- | --- |
| TCP connection | socket opens within 8s |
| API login handshake | plain or legacy login succeeds |
| Device identity | `/system/identity` and `/system/resource` return data |
| License level | level ≥ 4 (hotspot requirement); CHR/RouterOS 7 report "skipped" |
| Hotspot server | at least one enabled server on `/ip/hotspot` |
| API service | `/api` or `/api-ssl` is enabled and not restricted to another network |
| Clock | skew under 5 minutes |

Hard failures mark the router `rejected` or `offline` and store a readable `last_error`; warnings still accept the
router but tell the operator what will break voucher provisioning. Every check is written to `router_events` with the
full step list.

---

## Architecture

```
Customer phone / laptop                Operator browser
        │                                    │
        ▼                                    ▼
  /portal (captive portal)            /dashboard (admin UI)
        │                                    │
        └──────────────┬─────────────────────┘
                       ▼
        Next.js route handlers (Vercel, Node runtime)
                       │
        ┌──────────────┼────────────────────┐
        ▼              ▼                    ▼
  Supabase        RouterOS API        M-Pesa Daraja
  (Postgres+RLS)  (8728 / 8729)       (optional STK push)
                       │
                       ▼
                 MikroTik router
             hotspot users + profiles
```

Voucher activation is atomic in PostgreSQL (`activate_voucher` RPC with `SELECT … FOR UPDATE`), then the hotspot user
is pushed to the router. If the router rejects the user, a freshly activated voucher is rolled back to `unused` so the
customer does not lose time.

---

## Local setup

```bash
npm install
cp .env.example .env.local     # fill in the Supabase and crypto values
npm run db:migrate             # needs SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN
npm run db:seed                # starter packages + portal settings
npm run create-admin -- you@example.com 'a-strong-password'
npm run dev
```

Open http://localhost:3000, sign in at `/login`, then add a router.

### Developing without a MikroTik

```bash
npx tsx scripts/dev-fake-router.ts --port 8728 --mode plain
# or --mode legacy to exercise the MD5 challenge path
```

Add a router with host `127.0.0.1`, port `8728`, user `admin`, password `secret`. The acceptance report should show
every step passing.

### Tests

```bash
npm test        # 55 tests
npm run typecheck
npm run build
```

The suite runs a real TCP RouterOS test double (`tests/helpers/fake-router.ts`) in both handshake modes, so the login
negotiation, timeouts, trap handling and provisioning are exercised over a real socket rather than mocks.

---

## Supabase

Migrations live in `supabase/migrations` and are applied with the Management API:

```bash
SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_xxx npm run db:migrate
```

Tables: `routers`, `packages`, `vouchers`, `sessions`, `payments`, `router_events`, `settings`, `admin_users`.
RLS is enabled on every table. `admin_users` membership is the only way in; the public portal and all router
operations go through server routes using the service role key, which never reaches the browser.

Router passwords are encrypted with AES-256-GCM using `ROUTER_CREDENTIALS_KEY` before they are stored, so a database
dump alone does not expose device credentials.

---

## Deploy to Vercel

1. Import this repository in Vercel (framework preset: Next.js, root directory: repository root).
2. Add environment variables for Production and Preview:

   | Variable | Notes |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | server only, never expose |
   | `ROUTER_CREDENTIALS_KEY` | `openssl rand -base64 32` |
   | `CRON_SECRET` | `openssl rand -hex 24` |
   | `APP_URL` | `https://your-app.vercel.app` |
   | `MPESA_*` | optional, see below |

3. Deploy. `vercel.json` registers a daily heartbeat at 03:00 UTC. On Vercel Hobby only daily crons are allowed; on Pro
   change the schedule to `*/15 * * * *` for tighter monitoring. Vercel sends `Authorization: Bearer $CRON_SECRET`
   automatically.
4. Open the deployment, sign in with the admin created by `create-admin` (run it against the same Supabase project).

Nothing secret is committed: `.env*` is ignored and only `.env.example` is tracked.

---

## MikroTik preparation

Run on the router (RouterOS 6 and 7):

```routeros
/ip service enable api
/ip service set api port=8728
# optional, encrypted transport:
/ip service enable api-ssl
/ip service set api-ssl port=8729

/user group add name=viwango-api policy=api,read,write,test
/user add name=viwango-api group=viwango-api password="a-long-random-password"

# allow only the cloud egress IP if you have one
/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=203.0.113.10 action=accept place-before=0
```

Notes:

- The API user needs `write` to create hotspot users and profiles.
- Vercel functions do not have a fixed egress IP on Hobby/Pro, so either allow the port from the internet with a long
  password, restrict by a stable address list you maintain, or place the router behind a tunnel. Never leave the API
  open with a default password.
- For the customer portal to log people in automatically, set **Captive portal login URL** on the router, for example
  `http://10.5.50.1/login`. The portal appends `username` and `password` to that URL.

---

## Captive portal

`/portal` is public. Link the router's hotspot walled-garden to it (or use it as the login page), optionally with
`?router=<router-id>` so the code is provisioned on the right device. Customers can:

- activate an existing voucher code, and
- buy a package with M-Pesa when Daraja is configured.

If the router cannot be reached, the portal returns a clear error and the voucher stays unused.

### Optional M-Pesa

Set `MPESA_ENVIRONMENT`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY` and
`MPESA_CALLBACK_URL` (`https://your-domain/api/payments/mpesa/callback`). The callback is idempotent: a repeated
callback does not issue a second voucher.

---

## Troubleshooting

| Error code | Meaning | Fix |
| --- | --- | --- |
| `ROUTER_UNREACHABLE` | DNS failure or `ECONNREFUSED` | check host, enable `/ip service api`, port forward |
| `ROUTER_TIMEOUT` | socket opened but no reply | firewall dropping packets, wrong port, router overloaded |
| `ROUTER_CLOSED` | router closed the session | API rate limiting or service disabled mid-session |
| `ROUTER_AUTH_FAILED` | trap on login | wrong user/password, or user missing the `api` policy |
| `ROUTER_HANDSHAKE_FAILED` | challenge mismatch | router older than 6.43 → handshake mode `auto` |
| `ROUTER_TLS_FAILED` | certificate rejected | MikroTik self-signed cert → disable "Verify TLS certificate" |
| `ROUTER_COMMAND_FAILED` | trap on a command | user lacks `write`, or the hotspot menu is missing |
| `ROUTER_FATAL` | router killed the session | check `/log print` on the device |

---

## Project layout

```
src/app/                 landing, login, dashboard, portal, API routes
src/lib/mikrotik/        protocol codec, RouterOS client, hotspot helpers
src/lib/routers/         acceptance checks, health persistence, heartbeat
src/lib/supabase/        browser, cookie-bound server and service-role clients
supabase/migrations/     schema, RLS, atomic voucher activation
scripts/                 migrate, seed, create-admin, fake router
tests/                   protocol, handshake, acceptance, provisioning, crypto, M-Pesa
```

---

## Muhtasari kwa Kiswahili

- Hii ni toleo la **cloud** pekee. Haigusi mfumo uliopo kwenye VPS: hakuna faili, database au password
  inayoshirikiwa.
- Handshake ya MikroTik imerekebishwa: RouterOS 6.43+ inatumia login ya kawaida, na zaidi ya hapo mfumo
  unarudi kwenye MD5 challenge ya zamani. Mode iliyofanikiwa inahifadhiwa kwa kila router.
- Kila router inapitishwa **acceptance check** kabla ya kutumika: TCP, login, identity, license, hotspot server,
  API service na saa ya router.
- Voucher inaanzishwa kwa usalama ndani ya database, kisha mtumiaji wa hotspot anatumwa kwenye router. Kama router
  haikubali, voucher inarudi `unused` ili mteja asipoteze muda.
- Weka secrets kwenye Vercel environment variables tu. `.env.local` haipushwi GitHub.
- Kuanza: `npm install`, `npm run db:migrate`, `npm run db:seed`, `npm run create-admin -- barua@email 'password'`,
  kisha deploy Vercel.
