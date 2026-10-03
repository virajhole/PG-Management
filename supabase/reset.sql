-- Wipe every PG Manager table (data only - the schema stays).
-- Run supabase/schema.sql afterwards if you want the tables gone too.
truncate table
  public.transactions,
  public.light_bills,
  public.rent_cycles,
  public.customers,
  public.rooms,
  public.settings;
