alter table public.routers
  add column if not exists hotspot_server text,
  add column if not exists hotspot_login_url text;

alter table public.packages
  add column if not exists router_profile text;
