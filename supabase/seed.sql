-- ============================================================================
-- Sample data: 4 tenants (one overdue, one due in 3 days, one partial
-- payment, one with a light bill) + 2 rooms + settings.
--
-- Run AFTER supabase/schema.sql. Anyone who signs in can use the app.
-- ============================================================================

insert into public.settings (pg_name, upi_id, default_deposit, terms)
values ('My PG', 'mypg@upi', 5000,
  '1. Rent is due on the same date every month.
2. One month notice is required before leaving.
3. Guests are not allowed to stay overnight without permission.
4. Keep your room and the common areas clean.')
on conflict (id) do nothing;

insert into public.rooms (floor, room_no, sharing_type, monthly_rent) values
  (1, '101', 2, 15000),
  (1, '102', 3, null); -- null = charge the Settings price for 3 sharing

-- 1. Overdue: due 6 days ago, paid 5,000 of 13,000.
insert into public.customers (
  name, mobile, guardian_name, proof_type, proof_id, joining_date,
  sharing_type, rent_amount, deposit_amount, room_id, room_no, bed_no,
  due_day, next_due_date, status
)
select
  'Rahul Sharma', '9876543210', 'Suresh Sharma', 'AADHAAR', '123456789012',
  current_date - 36, 3, 13000, 5000, r.id, r.room_no, '1',
  extract(day from (current_date - 36))::int, current_date - 6, 'active'
from public.rooms r where r.room_no = '102';

-- 2. Due in 3 days, last month settled in full.
insert into public.customers (
  name, mobile, proof_type, proof_id, joining_date, sharing_type,
  rent_amount, deposit_amount, room_id, room_no, bed_no,
  due_day, next_due_date, status
)
select
  'Priya Nair', '9123456780', 'PAN', 'ABCDE1234F', current_date - 63,
  2, 15000, 5000, r.id, r.room_no, '2',
  extract(day from (current_date - 63))::int, current_date + 3, 'active'
from public.rooms r where r.room_no = '101';

-- 3. Due in 20 days, partial payment on the open cycle.
insert into public.customers (
  name, mobile, proof_type, proof_id, joining_date, sharing_type,
  rent_amount, deposit_amount, due_day, next_due_date, status
) values (
  'Aman Verma', '9988776655', 'AADHAAR', '234567890123', current_date - 10,
  1, 18000, 5000, extract(day from (current_date - 10))::int, current_date + 20, 'active'
);

-- 4. Paid up, with a pending light bill.
insert into public.customers (
  name, mobile, proof_type, proof_id, joining_date, sharing_type,
  rent_amount, deposit_amount, due_day, next_due_date, status
) values (
  'Deepak Rao', '9555444332', 'AADHAAR', '345678901234', current_date - 40,
  1, 18000, 5000, extract(day from (current_date - 40))::int, current_date + 20, 'active'
);

insert into public.rent_cycles (customer_id, due_date, rent_amount, paid_amount)
select id, current_date - 6, 13000, 5000 from public.customers where name = 'Rahul Sharma';

insert into public.rent_cycles (customer_id, due_date, rent_amount, paid_amount)
select id, current_date - 27, 15000, 15000 from public.customers where name = 'Priya Nair';
insert into public.rent_cycles (customer_id, due_date, rent_amount, paid_amount)
select id, current_date + 3, 15000, 0 from public.customers where name = 'Priya Nair';

insert into public.rent_cycles (customer_id, due_date, rent_amount, paid_amount)
select id, current_date + 20, 18000, 8000 from public.customers where name = 'Aman Verma';

insert into public.rent_cycles (customer_id, due_date, rent_amount, paid_amount)
select id, current_date + 20, 18000, 18000 from public.customers where name = 'Deepak Rao';

insert into public.light_bills (customer_id, month, bill_amount, paid_amount, note)
select id, to_char(current_date, 'YYYY-MM'), 700, 200,
       '80 units x Rs 4.25 + Rs 360 fixed charges'
from public.customers where name = 'Deepak Rao';

insert into public.transactions (customer_id, customer_name, type, ref_id, amount, date, mode, note)
select c.id, c.name, 'RENT', rc.id, 5000, current_date - 3, 'cash', 'Partial rent payment'
from public.customers c
join public.rent_cycles rc on rc.customer_id = c.id
where c.name = 'Rahul Sharma';

insert into public.transactions (customer_id, customer_name, type, ref_id, amount, date, mode, note)
select c.id, c.name, 'RENT', rc.id, 15000, current_date - 30, 'upi', 'Last month rent'
from public.customers c
join public.rent_cycles rc on rc.customer_id = c.id
where c.name = 'Priya Nair' and rc.paid_amount = 15000;

insert into public.transactions (customer_id, customer_name, type, ref_id, amount, date, mode, note)
select c.id, c.name, 'RENT', rc.id, 8000, current_date - 2, 'cash', 'Partial rent payment'
from public.customers c
join public.rent_cycles rc on rc.customer_id = c.id
where c.name = 'Aman Verma';

insert into public.transactions (customer_id, customer_name, type, ref_id, amount, date, mode, note)
select c.id, c.name, 'RENT', rc.id, 18000, current_date - 5, 'bank', 'Rent paid in advance'
from public.customers c
join public.rent_cycles rc on rc.customer_id = c.id
where c.name = 'Deepak Rao';

insert into public.transactions (customer_id, customer_name, type, ref_id, amount, date, mode, note)
select c.id, c.name, 'LIGHT_BILL', lb.id, 200, current_date - 1, 'cash', 'Part of the light bill'
from public.customers c
join public.light_bills lb on lb.customer_id = c.id
where c.name = 'Deepak Rao';
