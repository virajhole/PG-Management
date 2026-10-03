-- ============================================================================
-- FULL RESET - deletes every PG Manager table, old and new.
--
-- Run this ONLY if you are okay losing the tenant/room/payment test data
-- (for example to migrate an old-text-id database to the new uuid schema).
--
-- After running this file, run supabase/schema.sql to create the clean
-- tables, and optionally supabase/seed.sql for sample data.
-- ============================================================================

-- New-schema tables
drop table if exists public.transactions cascade;
drop table if exists public.light_bills cascade;
drop table if exists public.rent_cycles cascade;
drop table if exists public.customers cascade;
drop table if exists public.rooms cascade;
drop table if exists public.settings cascade;
drop table if exists public.admins cascade;

-- Legacy tables from removed features (older databases may still have them)
drop table if exists public.room_history cascade;
drop table if exists public.expenses cascade;
drop table if exists public.audit_log cascade;
drop table if exists public.complaints cascade;
drop table if exists public.notices cascade;
drop table if exists public.enquiries cascade;
drop table if exists public.visitors cascade;
drop table if exists public.rent_revisions cascade;
drop table if exists public.meter_readings cascade;
drop table if exists public.agreements cascade;
drop table if exists public.late_fees cascade;
drop table if exists public.assets cascade;
drop table if exists public.mess_menu cascade;

-- Legacy functions from older schema versions
drop function if exists public.create_customer_with_cycle(jsonb, text, text) cascade;
drop function if exists public.admit_customer(jsonb, text, text) cascade;
drop function if exists public.record_rent_payment(text, numeric, date, text, text) cascade;
drop function if exists public.record_light_bill_payment(text, text, numeric, date, text, text) cascade;
drop function if exists public.save_light_bill(text, text, text, numeric, numeric, numeric, text) cascade;
drop function if exists public.preview_rent_payment(text, numeric, numeric) cascade;
drop function if exists public.delete_transaction(text) cascade;
drop function if exists public.app_scope_user_id() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.auth_email() cascade;
drop function if exists public.has_admins() cascade;
drop function if exists public.plan_rent_payment(jsonb, numeric, int, numeric, numeric) cascade;
drop function if exists public.app_id(text) cascade;
drop function if exists public.bill_json(anyelement) cascade;
drop function if exists public.cycle_json(anyelement) cascade;
drop function if exists public.transaction_json(anyelement) cascade;
drop function if exists public.room_json(anyelement) cascade;
drop function if exists public.list_rooms() cascade;
drop function if exists public.move_customer(text, text, text, date) cascade;
drop function if exists public.give_notice(text, date, text) cascade;
drop function if exists public.vacate_customer(text, numeric, numeric, numeric, numeric, text, text) cascade;
drop function if exists public.delete_room(text) cascade;
drop function if exists public.upcoming_vacates(int) cascade;
drop function if exists public.monthly_finance(int) cascade;
drop function if exists public.dashboard_summary() cascade;
drop function if exists public.generate_due_cycles() cascade;
drop function if exists public.generate_due_cycles_for_all() cascade;
drop function if exists public.log_audit(text, text, text, text, numeric) cascade;
drop function if exists public.audit_feed(int) cascade;

drop view if exists public.customers_overview cascade;
drop view if exists public.rent_cycles_view cascade;
drop view if exists public.light_bills_view cascade;
drop view if exists public.rooms_occupancy cascade;
