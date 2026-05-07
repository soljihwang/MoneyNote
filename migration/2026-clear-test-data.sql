-- MoneyNote test data cleanup for 2026 Excel migration
-- Run this manually in Supabase SQL Editor before the import SQL.
TRUNCATE TABLE
  public.transactions,
  public.memos,
  public.months,
  public.month_settings,
  public.card_month_settings,
  public.category_month_settings
RESTART IDENTITY CASCADE;
