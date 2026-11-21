-- VIWANGO Hotspot Cloud: core schema
create extension if not exists pgcrypto;

do $$
begin
  create type public.router_status as enum ('pending', 'online', 'offline', 'rejected');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.voucher_status as enum ('unused', 'active', 'used', 'expired', 'revoked');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.session_status as enum ('active', 'closed');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_status as enum ('pending', 'paid', 'failed');
exception when duplicate_object then null;
end $$;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'admin' check (role in ('owner', 'admin', 'viewer')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.routers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  host text not null,
  api_port integer not null default 8728 check (api_port between 1 and 65535),
  use_tls boolean not null default false,
  tls_verify boolean not null default false,
  username text not null,
  password_enc text not null,
  auth_mode text check (auth_mode in ('plain', 'legacy-md5')),
  status public.router_status not null default 'pending',
  last_error text,
  last_seen_at timestamptz,
  accepted_at timestamptz,
  identity text,
  board_name text,
  ros_version text,
  architecture text,
  license_level integer,
  hotspot_servers text[] not null default '{}',
  health jsonb,
  agent_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create unique index if not exists routers_name_key on public.routers (lower(name));
create unique index if not exists routers_endpoint_key on public.routers (lower(host), api_port);

drop trigger if exists routers_touch_updated_at on public.routers;
create trigger routers_touch_updated_at
  before update on public.routers
  for each row execute function public.touch_updated_at();

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(12, 2) not null default 0 check (price >= 0),
  currency text not null default 'TZS',
  duration_minutes integer not null check (duration_minutes > 0),
  data_limit_mb integer check (data_limit_mb is null or data_limit_mb > 0),
  speed_limit_down text,
  speed_limit_up text,
  device_limit integer not null default 1 check (device_limit >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists packages_name_key on public.packages (lower(name));

create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  package_id uuid not null references public.packages (id) on delete restrict,
  router_id uuid references public.routers (id) on delete set null,
  status public.voucher_status not null default 'unused',
  batch_id uuid,
  price_paid numeric(12, 2) not null default 0,
  customer_phone text,
  payment_ref text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists vouchers_status_idx on public.vouchers (status);
create index if not exists vouchers_package_idx on public.vouchers (package_id);
create index if not exists vouchers_router_idx on public.vouchers (router_id);
create index if not exists vouchers_batch_idx on public.vouchers (batch_id);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.vouchers (id) on delete cascade,
  router_id uuid not null references public.routers (id) on delete cascade,
  username text not null,
  ip_address inet,
  mac_address text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  bytes_in bigint not null default 0,
  bytes_out bigint not null default 0,
  status public.session_status not null default 'active'
);

create index if not exists sessions_active_idx on public.sessions (router_id, status);
create index if not exists sessions_voucher_idx on public.sessions (voucher_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mpesa',
  phone text not null,
  amount numeric(12, 2) not null,
  reference text not null unique,
  status public.payment_status not null default 'pending',
  voucher_id uuid references public.vouchers (id) on delete set null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payments_status_idx on public.payments (status);

create table if not exists public.router_events (
  id bigserial primary key,
  router_id uuid not null references public.routers (id) on delete cascade,
  level text not null check (level in ('info', 'warn', 'error')),
  code text not null,
  message text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists router_events_router_idx on public.router_events (router_id, created_at desc);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row level security ------------------------------------------------------

alter table public.admin_users enable row level security;
alter table public.routers enable row level security;
alter table public.packages enable row level security;
alter table public.vouchers enable row level security;
alter table public.sessions enable row level security;
alter table public.payments enable row level security;
alter table public.router_events enable row level security;
alter table public.settings enable row level security;

drop policy if exists admin_users_admin_all on public.admin_users;
create policy admin_users_admin_all on public.admin_users
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists routers_admin_all on public.routers;
create policy routers_admin_all on public.routers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists packages_admin_all on public.packages;
create policy packages_admin_all on public.packages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists packages_public_read on public.packages;
create policy packages_public_read on public.packages
  for select to anon, authenticated using (is_active = true);

drop policy if exists vouchers_admin_all on public.vouchers;
create policy vouchers_admin_all on public.vouchers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists sessions_admin_all on public.sessions;
create policy sessions_admin_all on public.sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists payments_admin_all on public.payments;
create policy payments_admin_all on public.payments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists router_events_admin_all on public.router_events;
create policy router_events_admin_all on public.router_events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_admin_all on public.settings;
create policy settings_admin_all on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Atomic voucher activation ------------------------------------------------

create or replace function public.activate_voucher(p_code text, p_router_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vouchers;
  pkg public.packages;
  v_now timestamptz := now();
begin
  select * into v from public.vouchers where code = upper(trim(p_code)) for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  if v.status = 'revoked' then
    return jsonb_build_object('result', 'revoked');
  end if;

  if v.status = 'expired' or (v.expires_at is not null and v.expires_at <= v_now) then
    update public.vouchers set status = 'expired' where id = v.id;
    return jsonb_build_object('result', 'expired', 'expires_at', v.expires_at);
  end if;

  select * into pkg from public.packages where id = v.package_id;
  if pkg is null or pkg.is_active = false then
    return jsonb_build_object('result', 'package_inactive');
  end if;

  if v.status = 'unused' then
    update public.vouchers
       set status = 'active',
           activated_at = v_now,
           expires_at = v_now + make_interval(mins => pkg.duration_minutes),
           router_id = coalesce(v.router_id, p_router_id)
     where id = v.id
     returning * into v;
    return jsonb_build_object('result', 'activated', 'voucher', to_jsonb(v), 'package', to_jsonb(pkg));
  end if;

  -- Active and still inside its window: allow the customer to log in again.
  return jsonb_build_object('result', 'active', 'voucher', to_jsonb(v), 'package', to_jsonb(pkg));
end;
$$;

revoke all on function public.activate_voucher(text, uuid) from public, anon, authenticated;
grant execute on function public.activate_voucher(text, uuid) to service_role;
