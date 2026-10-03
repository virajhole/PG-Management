# PG Manager

A small, fast app for running a paying-guest (PG) property: tenants, rent
cycles with partial payments, light bills, rooms with beds, and a payments
log. React + Tailwind on the front, Supabase (Postgres + Auth + Storage) at
the back. No other services.

## Setup (10 minutes)

1. **Create a Supabase project** at [supabase.com](https://supabase.com).

2. **Run the database schema.** Supabase dashboard -> SQL Editor -> New query ->
   paste the whole of [supabase/schema.sql](supabase/schema.sql) -> Run.
   Safe to re-run any time; nothing is deleted.

3. **Optional - sample data** to explore the app: paste
   [supabase/seed.sql](supabase/seed.sql) -> Run (4 sample tenants: one
   overdue, one due in 3 days, one partial payment, one with a light bill).
   Remove later with supabase/reset.sql.

4. **Point the app at your project.** Copy .env.example to .env and fill in
   both values from Supabase -> Project Settings -> Data API:

       VITE_SUPABASE_URL=https://your-project.supabase.co
       VITE_SUPABASE_ANON_KEY=your-anon-key

   The anon key is public by design - every table is locked down by RLS so it
   only works for signed-in users of your project. Never put the service-role
   key in .env.

5. **Run it:**

       npm install
       npm run dev

6. **Deploy (optional):** npm run build and host the dist/ folder anywhere
   static (Vercel/Netlify work well). Set the same two VITE_* variables in the
   host's dashboard - Vite inlines them at build time, so changing them later
   means rebuilding.

7. **Sign in** with Google or email + password. Any signed-in account can use
   the app - there is no allow-list.

## What's in the app

- **Dashboard** - summary cards (total customers, overdue, due in 5 days,
  remaining rent, today's collection), search, filter chips (All / Overdue /
  Due Soon / Partial / Paid), and every active tenant sorted by next due date.
  Row colours: red = overdue, yellow = due within 5 days, green = fine. Each
  row has Record Payment and a WhatsApp reminder.
- **Admission** - the full tenant form with room picker (only rooms with a
  free bed of the matching sharing type), auto-filled rent, and terms.
- **Tenant page** - details, edit, delete, proof image, rent history, light
  bill history, payments log, and a one-tap Vacate.
- **Payments** - partial payments keep the due date; settling in full opens
  next month's cycle; overpayments become advance credit. Light bills are
  tracked separately and never touch rent.
- **Transactions** - today's and this month's collection, remaining rent and
  light bill, filters, a pending tab, CSV export. Deleting a payment
  recalculates the balances it had changed.
- **Rooms** - floor-wise rooms with bed occupancy; add / edit / delete
  (occupied rooms cannot be deleted).
- **Settings** - PG name, UPI id, sharing prices, default deposit, terms,
  WhatsApp template, export backup (JSON + CSV), erase all data.

## Database rules (short version)

- Every table has ONE access rule: the user must be signed in (any valid
  Google or email+password login). There is no allow-list. If you ever want to
  restrict the app to specific e-mails again, the commented block at the end of
  supabase/schema.sql has the SQL to bring the allow-list back.
- No owner columns anywhere - one shared ledger per Supabase project.
- Ids are database-generated uuids; the app never invents one.
- Money writes (admission, payments, payment deletion) go through three
  Postgres functions - create_customer, record_payment, delete_payment - so
  the partial / full / overpayment maths lives in exactly one place.
- Deleting a customer cascades: their cycles, bills and payments go too.

## Repair

If anything ever looks wrong (rows not appearing, edit/delete refusing):
re-run supabase/schema.sql in the SQL editor. It is idempotent and re-creates
the policies, functions and views in one consistent state. It never deletes
data.

## Scripts

    npm run dev         # local dev server
    npm run build       # production build into dist/
    npm run preview     # serve the production build locally
    npm test            # unit + component tests (vitest)
    npm run test:e2e    # browser smoke tests (playwright)
    npm run verify      # lint + build + tests

## Notes

- The font (Plus Jakarta Sans) is self-hosted in public/fonts/ - no runtime
  requests to Google Fonts.
- Data lives in your own Supabase account. Use Settings -> Export backup
  regularly; there is no server-side backup.
