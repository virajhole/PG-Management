-- ============================================================================
-- 006_late_fee_rpc.sql
-- record_flat_transaction: one RPC for ledger lines that are not rent-cycle
-- payments (currently the LATE_FEE type from 004, later maybe fines etc.).
--
-- It applies the amount to the tenant's open cycle like a payment (so the
-- balance and reports move together) but never rolls the due date forward or
-- opens the next cycle - only a real rent payment does that.
-- ============================================================================

create or replace function public.record_flat_transaction(
  p_type       text,
  p_customer_id text,
  p_cycle_id   text,
  p_amount     numeric,
  p_date       date,
  p_mode       text,
  p_note       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user     uuid := auth.uid();
  v_customer public.customers%rowtype;
  v_cycle    public.rent_cycles%rowtype;
  v_new_paid numeric;
  v_tx       public.transactions%rowtype;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  if p_type not in ('LATE_FEE') then
    raise exception 'Unsupported transaction type %.', p_type;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and user_id = v_user;
  if not found then
    raise exception 'Tenant not found.';
  end if;

  -- Fall back to the tenant's open cycle when none was supplied.
  if p_cycle_id is not null and p_cycle_id <> '' then
    select * into v_cycle from public.rent_cycles
    where id = p_cycle_id and user_id = v_user;
    if not found then
      raise exception 'That rent cycle no longer exists.';
    end if;
  else
    select * into v_cycle from public.rent_cycles
    where customer_id = p_customer_id and user_id = v_user and settled_at is null
    order by due_date asc
    limit 1;
  end if;

  v_new_paid := coalesce(v_cycle.paid_amount, 0) + round(p_amount, 2);

  if v_cycle.id is not null then
    update public.rent_cycles
    set paid_amount = v_new_paid,
        settled_at = case when v_new_paid >= rent_amount then now() else settled_at end,
        updated_at = now()
    where id = v_cycle.id;
  end if;

  insert into public.transactions (
    id, user_id, customer_id, customer_name, type, cycle_id, bill_id,
    amount, date, mode, note, opened_cycle_id,
    settled_at, due_date_before, due_date_after, created_at
  ) values (
    'txn_' || substr(md5(random()::text), 1, 12),
    v_user, v_customer.id, v_customer.name, p_type, v_cycle.id, null,
    round(p_amount, 2), coalesce(p_date, current_date), coalesce(p_mode, 'cash'),
    coalesce(p_note, ''), null,
    case when v_cycle.id is not null and v_new_paid >= v_cycle.rent_amount then now() else null end,
    v_cycle.due_date, v_cycle.due_date, now()
  )
  returning * into v_tx;

  return jsonb_build_object(
    'id', v_tx.id,
    'customerId', v_tx.customer_id,
    'customerName', v_tx.customer_name,
    'type', v_tx.type,
    'cycleId', v_tx.cycle_id,
    'billId', v_tx.bill_id,
    'amount', v_tx.amount::numeric,
    'date', v_tx.date,
    'mode', v_tx.mode,
    'note', v_tx.note,
    'createdAt', v_tx.created_at
  );
end;
$$;

revoke execute on function public.record_flat_transaction(text, text, text, numeric, date, text, text) from public, anon;
grant execute on function public.record_flat_transaction(text, text, text, numeric, date, text, text) to authenticated;
