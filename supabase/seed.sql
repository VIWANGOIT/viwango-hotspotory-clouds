-- Starter packages for a Tanzanian hotspot operator. Adjust prices freely.
insert into public.packages (name, description, price, currency, duration_minutes, data_limit_mb, speed_limit_down, speed_limit_up, device_limit)
values
  ('Saa 1', 'Internet kwa saa moja', 500, 'TZS', 60, null, '3M', '1M', 1),
  ('Saa 3', 'Internet kwa masaa matatu', 1000, 'TZS', 180, null, '3M', '1M', 1),
  ('Siku 1', 'Internet kwa siku moja', 2000, 'TZS', 1440, null, '5M', '2M', 2),
  ('Wiki 1', 'Internet kwa wiki moja', 8000, 'TZS', 10080, null, '5M', '2M', 2),
  ('Mwezi 1', 'Internet kwa mwezi mmoja', 25000, 'TZS', 43200, null, '10M', '3M', 3)
on conflict do nothing;

insert into public.settings (key, value)
values
  ('portal', '{"business_name":"VIWANGO Hotspot","support_phone":"","tagline":"Internet ya haraka, bili rahisi"}'::jsonb)
on conflict (key) do nothing;
