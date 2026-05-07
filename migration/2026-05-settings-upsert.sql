-- MoneyNote 2026-05 settings restore
-- Safe to run in Supabase SQL Editor
-- Restores only 2026-05 month/settings/card/category data

BEGIN;

INSERT INTO public.months (month)
VALUES ('2026-05')
ON CONFLICT (month) DO NOTHING;

INSERT INTO public.month_settings (month, total_budget, toggles)
VALUES ('2026-05', 1000000, '{}'::jsonb)
ON CONFLICT (month) DO UPDATE
SET
  total_budget = EXCLUDED.total_budget,
  toggles = EXCLUDED.toggles;

INSERT INTO public.category_month_settings (month, name, budget, inactive, sort_order)
VALUES
  ('2026-05', '외식배달', 100000, false, 0),
  ('2026-05', '식료품', 400000, false, 1),
  ('2026-05', '취미생활', 100000, false, 2),
  ('2026-05', '생필품', 150000, false, 3),
  ('2026-05', '애들', 100000, false, 4),
  ('2026-05', '양가', 50000, false, 5),
  ('2026-05', '품위유지', 100000, false, 6),
  ('2026-05', '재욱', 0, false, 7),
  ('2026-05', '충전', 0, false, 8),
  ('2026-05', '여행', 0, false, 9),
  ('2026-05', '위고비', 0, false, 10),
  ('2026-05', '솔지', 0, false, 11)
ON CONFLICT (month, name) DO UPDATE
SET
  budget = EXCLUDED.budget,
  inactive = EXCLUDED.inactive,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.card_month_settings (month, name, perf, disc, perf_default, disc_default, owner, inactive, sort_order)
VALUES
  ('2026-05', 'mg+s(나)', 600000, 340000, true, true, 'me', false, 0),
  ('2026-05', 'mg+s(나)할인', 300000, 0, false, true, 'me', false, 1),
  ('2026-05', 'KB포인트', 200000, 0, true, false, 'me', false, 2),
  ('2026-05', '더모아', 300000, 38400, true, true, 'me', false, 3),
  ('2026-05', '제일현대체크', 300000, 0, true, false, 'me', false, 4),
  ('2026-05', '재욱제이드', 30000, 0, true, false, 'spouse', false, 5),
  ('2026-05', '내 제이드', 30000, 0, true, false, 'me', false, 6),
  ('2026-05', '♥우리알뜰', 1, 0, true, false, 'common', false, 7),
  ('2026-05', 'mg+s(재욱)', 300000, 147955, true, true, 'spouse', false, 8),
  ('2026-05', 'mg+s(재욱)할인', 150000, 0, false, true, 'spouse', false, 9),
  ('2026-05', '내 mg', 0, 0, false, false, 'me', false, 10),
  ('2026-05', '네이버페이체크', 0, 0, false, false, 'me', false, 11)
ON CONFLICT (month, name) DO UPDATE
SET
  perf = EXCLUDED.perf,
  disc = EXCLUDED.disc,
  perf_default = EXCLUDED.perf_default,
  disc_default = EXCLUDED.disc_default,
  owner = EXCLUDED.owner,
  inactive = EXCLUDED.inactive,
  sort_order = EXCLUDED.sort_order;

COMMIT;
