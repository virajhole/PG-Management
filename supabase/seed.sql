-- ============================================================================
-- PG Manager - sample data
--
-- Run AFTER supabase/schema.sql, and only on a database you are happy to fill
-- with fake records. Everything here belongs to ONE owner: the first account
-- with a user_id in `admins`. That is the same partition `app_scope_user_id()`
-- resolves to, so the rows are visible to the team and to nobody else.
--
--   select email from public.admins where user_id is not null limit 1;
--
-- If that returns nothing, sign in to the app once first: bootstrap_owner()
-- claims the project and records your account. Then run this file again.
--
-- Every insert is idempotent (on conflict do nothing on the client-generated
-- text ids), so running it twice does not duplicate the sample PG.
-- ============================================================================

do $$
declare
  v_owner uuid;
begin
  select user_id into v_owner from public.admins where user_id is not null order by created_at limit 1;

  if v_owner is null then
    raise exception
      'No owner found in public.admins. Sign in to the app once (bootstrap_owner claims the project), then re-run seed.sql.';
  end if;

  ------------------------------------------------------------------ rooms
  insert into public.rooms (id, user_id, floor, room_no, sharing_type, monthly_rent, has_ac, has_attached_bathroom, notes, is_active)
  values
    ('room_101', v_owner, 0, '101', 1, null, true,  true,  'Single room, corner.',            true),
    ('room_102', v_owner, 0, '102', 2, null, false, true,  '',                               true),
    ('room_103', v_owner, 0, '103', 3, null, false, true,  'Spare triple, north side.',       true),
    ('room_204', v_owner, 1, '204', 2, null, true,  true,  '',                               true),
    ('room_205', v_owner, 1, '205', 3, null, true,  false, 'Common bathroom on the floor.',   true),
    -- Rent override: cheaper than the 2-sharing default.
    ('room_207', v_owner, 1, '207', 2, 9000, true,  true,  'Discounted - near the lift.',     true),
    ('room_310', v_owner, 2, '310', 3, null, true,  true,  '',                               true),
    ('room_405', v_owner, 2, '405', 4, null, true,  true,  '',                               true),
    ('room_502', v_owner, 2, '502', 5, null, true,  true,  'Full occupancy room.',            true),
    ('room_503', v_owner, 2, '503', 5, null, false, true,  'Under maintenance - do not allocate.', false)
  on conflict (id) do nothing;

  -------------------------------------------------------------- tenants
  insert into public.customers
    (id, user_id, code, name, mobile, sharing_type, rent_amount, deposit_amount, deposit_paid,
     room_id, room_no, bed_no, joining_date, due_day, next_due_date, status, terms_accepted, created_at)
  values
    ('cus_seed_rahul',  v_owner, 'PG-0001', 'Rahul Sharma',  '9876543210', 2, 8500,  8500,  true,
     'room_204', '204', '1', current_date - 200, 10, date_trunc('month', current_date) + interval '10 days' - interval '1 day', 'active', true, now()),
    ('cus_seed_priya',  v_owner, 'PG-0002', 'Priya Nair',    '9876543211', 1, 12000, 12000, true,
     'room_101', '101', '1', current_date - 400, 10, date_trunc('month', current_date) + interval '10 days' - interval '1 day', 'active', true, now()),
    ('cus_seed_aman',   v_owner, 'PG-0003', 'Aman Verma',    '9876543212', 3, 7000,  7000,  true,
     'room_310', '310', '2', current_date - 120, 10, date_trunc('month', current_date) + interval '10 days' + interval '3 days', 'active', true, now()),
    ('cus_seed_imran',  v_owner, 'PG-0004', 'Imran Sheikh',  '9876543213', 5, 5500,  5500,  true,
     'room_502', '502', '4', current_date - 90,  10, date_trunc('month', current_date) + interval '10 days' - interval '1 day', 'active', true, now()),
    ('cus_seed_sneha',  v_owner, 'PG-0005', 'Sneha Patil',   '9876543214', 4, 6500,  6500,  true,
     'room_405', '405', '3', current_date - 300, 10, date_trunc('month', current_date) + interval '10 days' - interval '1 day', 'notice', true, now()),
    -- Room 207 carries a rent override: the sample rent follows the room.
    ('cus_seed_deepak', v_owner, 'PG-0006', 'Deepak Joshi',  '9876543215', 2, 9000,  9000,  true,
     'room_207', '207', '2', current_date - 150, 10, date_trunc('month', current_date) + interval '10 days' - interval '1 day', 'active', true, now())
  on conflict (id) do nothing;

  -- Sneha is on notice; the lifecycle columns drive the orange status chip.
  update public.customers
     set notice_given_at = current_date - 10,
         expected_leaving_date = current_date + 14,
         notice_note = 'Moving closer to college.'
   where id = 'cus_seed_sneha';

  -- ------------------------------------------------------- rent cycles
  insert into public.rent_cycles (id, user_id, customer_id, due_date, rent_amount, paid_amount, settled_at, created_at)
  values
    -- Rahul: overdue with a partial payment left on the balance.
    ('cyc_seed_rahul',  v_owner, 'cus_seed_rahul',  date_trunc('month', current_date) - interval '1 month' + interval '9 days', 8500, 4000, null, now() - interval '40 days'),
    -- Priya: settled.
    ('cyc_seed_priya',  v_owner, 'cus_seed_priya',  date_trunc('month', current_date) - interval '1 month' + interval '9 days', 12000, 12000, now() - interval '20 days', now() - interval '40 days'),
    -- Aman: due in three days, untouched.
    ('cyc_seed_aman',   v_owner, 'cus_seed_aman',   date_trunc('month', current_date) + interval '3 days', 7000, 0, null, now() - interval '5 days'),
    -- Imran: paid on time.
    ('cyc_seed_imran',  v_owner, 'cus_seed_imran',  date_trunc('month', current_date) - interval '1 month' + interval '9 days', 5500, 5500, now() - interval '25 days', now() - interval '40 days'),
    -- Sneha: settled, but leaving soon.
    ('cyc_seed_sneha',  v_owner, 'cus_seed_sneha',  date_trunc('month', current_date) - interval '1 month' + interval '9 days', 6500, 6500, now() - interval '22 days', now() - interval '40 days'),
    -- Deepak: partial, so the balance strip has something to show.
    ('cyc_seed_deepak', v_owner, 'cus_seed_deepak', date_trunc('month', current_date) - interval '1 month' + interval '9 days', 9000, 6000, null, now() - interval '35 days')
  on conflict (id) do nothing;

  --------------------------------------------------------- transactions
  insert into public.transactions (id, user_id, customer_id, customer_name, type, cycle_id, amount, date, mode, note, created_at)
  values
    ('txn_seed_1', v_owner, 'cus_seed_rahul',  'Rahul Sharma', 'RENT',  'cyc_seed_rahul',  4000,  current_date - 8,  'upi',  'Part payment',        now() - interval '8 days'),
    ('txn_seed_2', v_owner, 'cus_seed_priya',  'Priya Nair',   'RENT',  'cyc_seed_priya',  12000, current_date - 12, 'cash', 'Full month',           now() - interval '12 days'),
    ('txn_seed_3', v_owner, 'cus_seed_imran',  'Imran Sheikh', 'RENT',  'cyc_seed_imran',  5500,  current_date - 15, 'cash', '',                    now() - interval '15 days'),
    ('txn_seed_4', v_owner, 'cus_seed_sneha',  'Sneha Patil',  'RENT',  'cyc_seed_sneha',  6500,  current_date - 14, 'upi',  '',                    now() - interval '14 days'),
    ('txn_seed_5', v_owner, 'cus_seed_deepak', 'Deepak Joshi', 'RENT',  'cyc_seed_deepak', 6000,  current_date - 10, 'cash', 'Part payment',        now() - interval '10 days'),
    ('txn_seed_6', v_owner, 'cus_seed_priya',  'Priya Nair',   'DEPOSIT', null,               12000, current_date - 400, 'cash', 'Security deposit',     now() - interval '400 days')
  on conflict (id) do nothing;

  ------------------------------------------------------------ light bills
  insert into public.light_bills (id, user_id, customer_id, month, units, rate_per_unit, bill_amount, paid_amount, note)
  values
    ('bil_seed_1', v_owner, 'cus_seed_rahul',  to_char(current_date, 'YYYY-MM'), 96, 7.5, 720,  0,    ''),
    ('bil_seed_2', v_owner, 'cus_seed_deepak', to_char(current_date, 'YYYY-MM'), 140, 7.5, 1050, 500, 'Part paid')
  on conflict (id) do nothing;

  -------------------------------------------------------------- expenses
  insert into public.expenses (id, user_id, category, amount, date, note)
  values
    ('exp_seed_1', v_owner, 'electricity',  8400, current_date - 20, 'Common meter - month'),
    ('exp_seed_2', v_owner, 'water',       1200, current_date - 20, 'Borewell recharge'),
    ('exp_seed_3', v_owner, 'groceries',   3500, current_date - 12, 'Kitchen'),
    ('exp_seed_4', v_owner, 'internet',    1499, current_date - 10, 'Broadband'),
    ('exp_seed_5', v_owner, 'salary',     12000, current_date - 5,  'Watchman - first week')
  on conflict (id) do nothing;

  ------------------------------------------------------------- complaints
  insert into public.complaints (id, user_id, title, category, priority, status, room_no, customer_id, description, assigned_to)
  values
    ('cmp_seed_1', v_owner, 'Fan not working',      'electricity', 'high',   'open',        '204', 'cus_seed_rahul',  'Stopped two nights ago.',            ''),
    ('cmp_seed_2', v_owner, 'Bathroom tap leaking', 'water',       'medium', 'in_progress', '310', 'cus_seed_aman',   'Dripping overnight.',               'Plumber'),
    ('cmp_seed_3', v_owner, 'Wi-Fi drops at night',  'wifi',       'low',    'resolved',    '405', 'cus_seed_sneha',  'Router needs a reboot.',            'IT')
  on conflict (id) do nothing;

  ---------------------------------------------------------------- notices
  insert into public.notices (id, user_id, title, body, date)
  values
    ('not_seed_1', v_owner, 'Water supply off on Sunday', 'Plumbing work from 9am to 1pm. Please store water in advance.', current_date),
    ('not_seed_2', v_owner, 'Gate closes at 10pm',        'Visitors must leave before 10pm. No exceptions.',              current_date - 5)
  on conflict (id) do nothing;

  -------------------------------------------------------------- enquiries
  insert into public.enquiries (id, user_id, name, phone, preferred_sharing, budget, expected_join_date, status, note)
  values
    ('enq_seed_1', v_owner, 'Kavya Rao',   '9812345670', 2, 9000,  current_date + 14, 'new',      'Asked about the discounted 207.'),
    ('enq_seed_2', v_owner, 'Manish Gupta', '9812345671', 3, 7500, current_date + 7,   'contacted', 'Wants a bed on floor 2.')
  on conflict (id) do nothing;

  -------------------------------------------------------------- visitors
  insert into public.visitors (id, user_id, name, phone, visiting_whom, purpose, in_time, out_time, date)
  values
    ('vis_seed_1', v_owner, 'Sunita Devi', '9765432100', 'Rahul Sharma', 'Family visit', '17:00', '19:30', current_date),
    ('vis_seed_2', v_owner, 'Arjun Menon', '9765432101', 'Sneha Patil',  'Delivery',     '13:15', '13:45', current_date)
  on conflict (id) do nothing;

  ------------------------------------------------------- meter readings
  insert into public.meter_readings (id, user_id, room_id, room_no, month, previous_reading, current_reading, rate_per_unit, total_units, total_amount)
  values
    ('mtr_seed_1', v_owner, 'room_204', '204', to_char(current_date, 'YYYY-MM'), 1240, 1336, 7.5, 96,  720),
    ('mtr_seed_2', v_owner, 'room_310', '310', to_char(current_date, 'YYYY-MM'), 880,  1008, 7.5, 128, 960),
    ('mtr_seed_3', v_owner, 'room_207', '207', to_char(current_date, 'YYYY-MM'), 1560, 1642, 7.5, 82,  615)
  on conflict (id) do nothing;

  ---------------------------------------------------------------- assets
  insert into public.assets (id, user_id, room_id, room_no, item, quantity, condition, note)
  values
    ('ast_seed_1', v_owner, 'room_204', '204', 'cot',       2, 'good',   ''),
    ('ast_seed_2', v_owner, 'room_204', '204', 'mattress',  2, 'worn',   'One has a visible tear'),
    ('ast_seed_3', v_owner, 'room_204', '204', 'cupboard',  2, 'good',   ''),
    ('ast_seed_4', v_owner, 'room_207', '207', 'AC',        1, 'good',   'Serviced in May'),
    ('ast_seed_5', v_owner, 'room_207', '207', 'study table',1,'broken', 'Leg snapped'),
    ('ast_seed_6', v_owner, 'room_502', '502', 'fan',       5, 'worn',   ''),
    ('ast_seed_7', v_owner, 'room_405', '405', 'chair',     4, 'good',   ''),
    ('ast_seed_8', v_owner, 'room_310', '310', 'mattress',  3, 'new',    '')
  on conflict (id) do nothing;

  -------------------------------------------------------------- mess menu
  insert into public.mess_menu (id, user_id, day, meal, items)
  values
    ('mess_seed_1', v_owner, 'Monday',    'Breakfast', 'Poha, banana'),
    ('mess_seed_2', v_owner, 'Monday',    'Lunch',     'Dal, rice, sabzi'),
    ('mess_seed_3', v_owner, 'Monday',    'Dinner',    'Roti, curry, salad'),
    ('mess_seed_4', v_owner, 'Tuesday',   'Breakfast', 'Idli, sambar'),
    ('mess_seed_5', v_owner, 'Tuesday',   'Lunch',     'Rice, rasam, poriyal'),
    ('mess_seed_6', v_owner, 'Tuesday',   'Dinner',    'Fried rice'),
    ('mess_seed_7', v_owner, 'Wednesday', 'Breakfast', 'Bread, jam, eggs'),
    ('mess_seed_8', v_owner, 'Wednesday', 'Lunch',     'Bisi bele bath, curries'),
    ('mess_seed_9', v_owner, 'Wednesday', 'Dinner',    'Dosa, chutney')
  on conflict (id) do nothing;

  -- ------------------------------------------------------------ settings
  insert into public.settings (
    user_id, sharing_prices, default_deposit, rent_due_day_of_month,
    pg_name, owner_name, owner_mobile, upi_id, late_fee_mode, late_fee_value,
    late_fee_grace_days, late_fee_max, mess_enabled, mess_charges
  )
  values (
    v_owner,
    '{"1": 12000, "2": 8500, "3": 7000, "4": 6500, "5": 5500}'::jsonb,
    8000, 10,
    'Sunrise Paying Guest', 'PG Manager', '9876500000', '', 'none', 0, 0, null, true, 3500
  )
  on conflict (user_id) do nothing;

  raise notice 'Sample PG seeded for owner %.', v_owner;
end;
$$;

select 'sample data seeded - sign in and open the dashboard' as next_step;