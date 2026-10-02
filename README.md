# PG Manager

A mobile-first paying-guest (PG) management app. Track tenants, rent dues, identity
proofs and payments, with everything stored in your own Supabase project and visible
only to your account.

## Features

- **Dashboard** — totals for tenants, overdue rent, dues within 5 days and expected
  monthly rent, plus a searchable, filterable list of tenants.
- **Rent status colour coding** — red when overdue, amber when due within 5 days,
  green when healthy. The list is sorted so the most overdue tenant is first.
- **WhatsApp reminders** — one tap opens WhatsApp with a pre-filled rent reminder
  message for that tenant.
- **Payment recording** — record an amount, mode and date; the due date rolls forward
  one month and the tenant shows as paid.
- **Admission form** — validated with React Hook Form + Zod, with Aadhaar/PAN format
  checking, automatic rent lookup by sharing type, and photo/proof upload.
- **Customer details** — full record, payment history, proof viewer, inline editing,
  edit and delete.
- **Settings** — per-sharing-type pricing, deposit, editable terms & conditions, PG
  and owner details, sample data, backup/restore and a full data wipe.
- **Accounts** — "Continue with Google" as the primary sign-in, email and password as
  the fallback. Access is allow-listed through an `admins` table, so signing in
  successfully is not enough: an address that is not on the team sees
  "Access denied, contact the owner" and is signed straight back out.
- **Team** — Settings → Team lets the owner add or remove admin/staff email addresses
  without touching the database.
- **Installable PWA** — add to the home screen, launches full screen, caches the app
  shell for offline use.
- **Never blanks out** — a global error boundary plus one per route means a broken
  page shows "Something went wrong / Retry" instead of taking the whole app down.

## Tech

- [React 19](https://react.dev) + [Vite](https://vite.dev)
- [Tailwind CSS v4](https://tailwindcss.com) (via `@tailwindcss/vite`)
- [React Router 7](https://reactrouter.com)
- [React Hook Form](https://react-hook-form.com) + [Zod](https://zod.dev)
- [Day.js](https://day.js.org) for all date maths
- [supabase-js](https://supabase.com/docs/reference/javascript) for Auth, Postgres,
  Storage and RPCs
- Context + hooks for state
- [Vitest](https://vitest.dev) + Testing Library for tests

## Getting started

You need a Supabase project first (see [Setting up Supabase](#setting-up-supabase)).
Then:

```bash
npm install
cp .env.example .env   # fill in your project URL and anon key
npm run dev
```

Open the printed local URL. On a phone, use the network URL so the app runs on the
same device you will actually use it on.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the full test suite once |
| `npm run test:watch` | Watch mode |
| `npm run test:e2e` | Playwright smoke test: opens every route, fails on any app console error |
| `npm run lint` | Lint with [oxlint](https://oxc.rs/docs/guide/usage/linter.html) |
| `npm run schema:build` | Rebuild `supabase/schema.sql` from the ordered migrations |
| `npm run schema:audit` | Check the SQL against what the frontend reads and writes |
| `npm run verify` | lint + build + unit tests + SQL audit |

## Setting up Supabase

There are two paths. Pick one.

| Your project | Use |
| --- | --- |
| Fresh, or you do not care about existing data | [Full reset](#a-full-reset-recommended-for-a-new-install) |
| Already in use, has tenants | [In-place repair](#b-in-place-repair-no-data-lost) |

Both end with the same `supabase/schema.sql` state; only the first destroys
everything first.

### A. Full reset (recommended for a new install)

Run these four files in order in the Supabase SQL editor
(**Dashboard → SQL Editor → New query**). Or with the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push          # if you keep the migrations in your migration history
```

#### 1. Back up first

There is no undo. **Dashboard → Database → Backups**, or:

```bash
supabase db dump --data-only -f backup-$(date +%F).sql
```

#### 2. Reset

Paste and run [`supabase/reset.sql`](supabase/reset.sql). It unschedules `pg_cron`
jobs, drops `public` with `cascade` and recreates it with Supabase's standard grants.
Everything you ever created in `public` goes with it — the storage bucket survives,
because it lives in the `storage` schema.

#### 3. Create the schema

Paste and run [`supabase/schema.sql`](supabase/schema.sql). It is the consolidated,
ordered, idempotent version of every migration plus the access-control section: 20
tables, the views, indexes, the RPCs, RLS policies and the storage bucket policy.
Running it twice is a no-op.

#### 4. Create the private bucket

`schema.sql` inserts the `identity-docs` bucket for you. If your project already has
one under a different name, create it by hand instead:
**Storage → New bucket → `identity-docs`, Public OFF**, then re-run `schema.sql` so
it installs the policies that match.

#### 5. Seed (optional)

Paste and run [`supabase/seed.sql`](supabase/seed.sql) for a demo PG: 10 rooms,
6 tenants covering every status colour, payments, expenses, complaints, notices,
enquiries, visitors, meter readings, assets and a mess menu.

> Sign in to the app once *before* seeding. The first account on an empty allow-list
> claims ownership (`bootstrap_owner()`), and `seed.sql` attaches the sample data to
> that account.

#### 6. Verify

```sql
-- every table the app expects
select table_name from information_schema.tables
 where table_schema = 'public' order by table_name;

-- RLS is on everywhere
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' and not rowsecurity;

-- no policy still scopes by auth.uid() directly
select tablename, policyname from pg_policies
 where schemaname = 'public' and qual like '%auth.uid()%';

-- the allow-list
select * from public.admins;
```

Expect the first to list all 20 tables, the second to return **zero rows**, and the
third to return **zero rows** as well — every policy routes through
`app_scope_user_id()` instead.

### B. In-place repair (no data lost)

Paste and run [`supabase/repair.sql`](supabase/repair.sql). It contains only
`create ... if not exists`, `add column if not exists`, `drop policy if exists` and
`drop constraint if exists` — nothing is dropped, truncated or overwritten, so it is
safe against a populated production project. It creates every table and column added
by migrations 003-005, installs the `admins` allow-list and its functions, widens the
`transactions` type check so `LATE_FEE` rows are accepted, and re-applies every policy
against the allow-list.

Then run the **Verify** query above.

### Which file do I use?

| Situation | File |
| --- | --- |
| New project, or starting over | `reset.sql` → `schema.sql` → `seed.sql` |
| Existing project missing tables or columns | `repair.sql` |
| Editing migrations and want the one-file version regenerated | `node scripts/build-schema.mjs` |

`supabase/migrations/` stays the source of truth for the schema. `schema.sql` is
generated from it by `scripts/build-schema.mjs`, which performs only two rewrites —
routing every `user_id = auth.uid()` check through `app_scope_user_id()`, and prefixing
each `create policy` with `drop policy if exists` so the file is re-runnable.
`npm run schema:audit` cross-checks the result against what the frontend actually
reads and writes and fails on any mismatch.

### 2. Configure sign-in

**Authentication → Providers → Email**: enable it, so the email/password fallback
works. Turning off *Confirm email* makes sign-up instant.

For Google, see [Google sign-in](#google-sign-in) below.

### 3. Point the app at it

Push to GitHub and import the repo into Vercel — it detects Vite automatically and
uses the committed `vercel.json` (SPA rewrites plus the service worker and asset
cache headers). The only required step is adding the two environment variables:

**Vercel → Project → Settings → Environment Variables**

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your anon key |

Apply them to **Production**, **Preview** and **Development**, then redeploy. These
are baked in at build time, so a rebuild is required after changing them.

Then add your deployed origin to **Authentication → URL Configuration → Redirect
URLs**, otherwise Supabase sends the browser back to `localhost` after sign-in.

## Google sign-in

### 1. Google Cloud project

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create (or
   pick) a project.
2. **APIs & Services → OAuth consent screen**. Choose *External*, fill in the app
   name, your support email and developer contact email.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Choose **Web application**.

   | Field | Value |
   | --- | --- |
   | Name | `PG Manager` |
   | Authorized JavaScript origins | `http://localhost:5173` and `https://your-app.vercel.app` |
   | Authorized redirect URIs | `https://<project-ref>.supabase.co/auth/v1/callback` |

   The redirect URI must match Supabase's exactly, including the trailing
   `/auth/v1/callback`. Copy the **Client ID** and **Client secret**.

### 2. Supabase provider

**Authentication → Providers → Google**: tick it on, paste the client ID and secret,
save. Supabase registers its own callback, so the Google console entry above is all
the wiring you need.

### 3. Redirect URLs

**Authentication → URL Configuration → Redirect URLs** — add both:

| URL | When |
| --- | --- |
| `http://localhost:5173` | Local development (`npm run dev`) |
| `https://your-app.vercel.app` | Production |

The app sends `redirectTo: window.location.origin`, so whatever host it is served
from is where Google returns to. Wildcards (`https://**.vercel.app`) work for preview
deployments but are easy to leave behind by accident — add each one you actually use.

Also set **Authentication → URL Configuration → Site URL** to your production origin.

### 4. Allow-list the people

Signing in is not enough to reach the ledger. The first account to sign in on an
empty allow-list claims the project automatically; after that, only addresses in
`admins` get in.

- **In the app:** Settings → Team. Add an address, pick *Admin* (full access, can
  manage the team) or *Staff* (can use the app, cannot change who has access). Your
  own row cannot be removed, so nobody can lock the owner out.
- **In SQL** (useful for the very first account, or a headless setup):

  ```sql
  insert into public.admins (email, role) values ('you@gmail.com', 'admin');
  ```

Anyone else who signs in gets an **"Access denied"** screen and is signed out
immediately — the session is dropped rather than left hanging around.

#### "Database not set up"

There is a second, easily-mistaken failure: the app cannot find `public.admins` at
all, because the project only has migrations 001-002 applied. Every sign-in is then
rejected — **including the owner's** — and "add yourself under Settings → Team" is
impossible advice, because the app never opens. The app detects this case (PostgREST
answers `PGRST205 Could not find the table 'public.admins'`) and shows a different
screen with the fix:

1. **Supabase dashboard → SQL Editor → New query**
2. Paste and run [`supabase/repair.sql`](supabase/repair.sql) — idempotent, so
   running it twice is a no-op.
3. Sign in again. On an empty allow-list the first account claims the project, so
   yours goes straight in.

Verify with:

```sql
select to_regclass('public.admins') as admins_table,   -- must not be null
       count(*)                  as people;           -- 0 before you sign in
```

If `people` is already above zero and your address is not in it, add it explicitly:

```sql
insert into public.admins (email, role) values ('you@gmail.com', 'owner');
```

### How the allow-list is enforced

`is_admin()` is the single question every policy asks, and it is enforced in the
database, not just in the UI:

```sql
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from admins
                    where lower(email) = lower(auth.jwt() ->> 'email')) $$;
```

Signing in with a *different* Google account produces a different `email` claim, so
the JWT is the credential. `auth.jwt()` is signed by Supabase and cannot be forged
from the browser.

Because several people now share one ledger, "whose rows is this?" can no longer be
answered with `auth.uid()` alone. A second resolver, `app_scope_user_id()`, answers
it once for every table, RPC and storage rule:

| Caller | Returns |
| --- | --- |
| Not signed in | `null` — every `user_id = <this>` is false, and every write RPC raises |
| Allow-list still empty | their own uid, so a project created before the allow-list keeps working |
| Listed address | the owner partition, so the whole team works on one ledger |
| Not listed | `null` — they see zero rows |

## Test checklist

Manual pass after a deploy or a database change. The first five are the regression
tests for the crashes that were reported; the last two are the Google flow.

- [ ] **Search opens** — Ctrl/Cmd+K (or the magnifier) opens the sheet. Typing shows
      matches. Typing nonsense shows "No matches" instead of a white screen.
- [ ] **Search is empty-safe** — opening it and pressing a key with nothing loaded
      does not throw.
- [ ] **Assets opens** — `/assets` renders the heading. With no assets you get the
      empty state; with the table missing you get "The assets table is missing" and a
      working **Try again**, not a crash.
- [ ] **Every route opens** — `/`, `/admission`, `/customers`, `/rooms`,
      `/transactions`, `/expenses`, `/operations`, `/reports`, `/meters`, `/mess`,
      `/assets`, `/settings`. No route shows "Something went wrong".
- [ ] **A payment records** — open a tenant, **Record payment**, confirm. The balance
      drops, the entry appears in the history, and the due date rolls forward when
      the cycle settles.
- [ ] **Google login works** — "Continue with Google" returns to the app signed in,
      and the header menu shows the Google name and avatar.
- [ ] **A non-allowlisted account is blocked** — sign in with a Google account that is
      not in Settings → Team. You get "Access denied", and refreshing sends you back
      to `/login` rather than into the app.
- [ ] **The first account claims the project** — on a fresh database, the first
      Google sign-in goes straight in (no "Access denied" flash) even though
      Settings → Team is empty. This is the one-time owner claim.
- [ ] **A missing database explains itself** — point the app at a project without
      the `admins` table and sign in. You get "Database not set up" with the SQL
      to run, not "Access denied".
- [ ] **Adding to the team works** — add an address in Settings → Team, then sign in
      with it. It works; removing it again blocks it.
- [ ] **An offline edit survives** — turn the network off, change something, turn it
      back on: the red banner appears and disappears and the change sticks.

### Automated

```bash
npm run verify     # lint + build + 272 unit tests + SQL audit
npm run test:e2e   # Playwright: every route, fails on any app console error
```

The Playwright suite covers the public routes with no credentials. Set
`SMOKE_EMAIL`/`SMOKE_PASSWORD` to also exercise the signed-in routes:

```bash
npx playwright install chromium     # once
SMOKE_EMAIL=you@gmail.com SMOKE_PASSWORD=... npm run test:e2e
```

Backend 404s (a table that does not exist yet) are reported separately from app
errors, so the run tells you which SQL to apply without failing on a database that
has not been migrated yet.

## How the data is stored

| Data | Where | Notes |
| --- | --- | --- |
| Tenants, rent cycles, light bills, transactions | Postgres | `user_id = app_scope_user_id()`, RLS on every table |
| Rooms, occupancy, expenses, audit log | Postgres | Occupancy is computed, never stored |
| Complaints, notices, enquiries, visitors | Postgres | Migration 003 |
| Agreements, rent revisions, meter readings, late fees | Postgres | Migration 004 |
| Assets, mess menu | Postgres | Migration 005 |
| Allow-list | Postgres `admins` | Keyed by e-mail, not by auth uid |
| Settings | Postgres, one row per ledger | Keyed by `user_id` |
| Photos and identity proofs | Private Storage bucket | Read only through 6-hour signed URLs |

All access goes through one module, `src/services/supabase.js`. The service modules
above it (`customerService`, `cycleService`, `lightBillService`, `transactionService`,
`settingsService`, `imageService`, `authService`) never talk to the network
themselves, and the pages never import the data layer directly. Swapping the backend
means changing one file.

Money mutations are Postgres functions (`SECURITY DEFINER`, re-scoped by
`app_scope_user_id()` inside) rather than a read-then-write in JavaScript, so two
devices cannot interleave a payment into an inconsistent balance:

- `preview_rent_payment` — what an amount will do before you commit it
- `record_rent_payment` — apply it, settle the cycle and open the next one
- `save_light_bill` / `record_light_bill_payment`
- `record_flat_transaction` — non-cycle ledger lines (late fees)
- `delete_transaction` — reverse it and restore the cycle and credit
- `import_backup` / `wipe_all`

Storage objects are namespaced `<ledger-owner>/c/<customer-id>/...`, and the bucket
policy uses the same resolver as the tables, so a path from one PG can never resolve
in another.

## Backup and portability

Settings → *Backup & restore* exports the whole account as JSON (or CSV for the
spreadsheet) and imports one back. The JSON includes the actual ID document bytes,
not just their storage paths, so a snapshot restores correctly into a different
account. Import is one atomic database call, so it cannot half-apply.

Coming from the older on-device version? Settings → *Import local data* converts
whatever the previous version left in this browser's `localStorage` into your account.
It is deliberately user-triggered, never automatic, and keeps a copy of the original
under `pgm.backup.v1` before converting anything.

## Routes

| Route | Screen |
| --- | --- |
| `/` | Dashboard and tenant list |
| `/admission` | New tenant admission |
| `/customers` | Tenant directory |
| `/customer/:id` | Tenant details |
| `/transactions` | Payment history |
| `/rooms` | Rooms, beds and occupancy |
| `/expenses` | Running costs |
| `/operations` | Complaints, notices, enquiries, visitors |
| `/reports` | Collection, occupancy and finance reports |
| `/meters` | Per-room electricity meters |
| `/mess` | Weekly mess menu |
| `/assets` | Room inventory and condition |
| `/settings` | Settings, including the team allow-list |
| `/login` | Sign in with Google or email |

Every route except `/login` sits behind the auth gate and the allow-list check. Each
one is also wrapped in its own error boundary, so a render-time throw replaces that
page with a retry screen instead of unmounting the app.

## Testing

```bash
npm test
```

- `src/utils/dateLogic.test.js` — rent due-date maths, month-end clamping, statuses.
- `src/utils/validation.test.js` — admission/edit schema rules and input sanitisers.
- `src/utils/ledger.test.js` — payment planning, credits and cycle roll-forward.
- `src/services/customerService.test.js` — CRUD, payment roll-forward, sorting, totals.
- `src/services/ledgerServices.test.js` — rent cycles, light bills and transactions.
- `src/services/backupService.test.js` — export/import round-trip, CSV, wipe.
- `src/pages/pages.test.jsx` — real components against the real service layer:
  colour coding, filtering, the payment flow, and form validation.
- `src/App.test.jsx` — smoke tests for the router, the auth gate, the allow-list
  (including a non-allowlisted Google account being denied and signed out), the
  layout, the lazily loaded routes and recording a payment end to end.
- `src/components/ErrorBoundary.test.jsx` — regressions for the Assets and Global
  Search crashes, plus the retry screen itself.
- `src/utils/lateFee.test.js`, `src/utils/meterSplit.test.js`, `src/utils/upi.test.js`
  — late-fee rules, bill splitting and UPI deep links.

Tests run against `src/test/supabaseFake.js`, an in-memory stand-in that exposes the
same surface as the real data layer (including the same `p_`-prefixed RPC argument
names and the same `is_admin()` allow-list semantics). Each test seeds its own data —
the app itself no longer seeds demo data on boot.

Service tests run in the plain `node` environment with a small `localStorage`
stand-in; the page tests opt into `happy-dom` with a per-file docblock.

## Notes and limitations

- **Aadhaar and PAN numbers are stored in plain text** in your database, because the
  app needs to show them. Anyone with dashboard access to the Supabase project can
  read them, so keep the project private and use per-owner accounts if more than one
  person needs access.
- **Requires a network connection** for anything beyond the cached app shell. There
  is no offline write queue; if you go offline, existing screens stay visible but new
  writes will fail until the connection returns.
- Sample tenants are generated with due dates relative to today, so the demo always
  looks realistic. Settings → *Add sample tenants* (or *Erase all tenant data*)
  manages them.
- `public/sw.js` is a hand-written service worker that precaches the app shell and
  serves assets cache-first. It only registers in production builds, so it never
  interferes with development.

## Project structure

```
src/
  components/   Reusable UI: layout, customer list, form fields, dialogs,
                ErrorBoundary, icons
  context/      Auth, data and toast providers
  hooks/        useImageUrl, useInstallPrompt, useOnlineStatus
  pages/        Dashboard, Admission, CustomerDetails, Customers, Transactions,
                Rooms, Expenses, Operations, Reports, Meters, Mess, Assets,
                Settings, Login, AccessDenied
  services/     supabase.js (the only module that talks to Supabase) plus the
                service facades above it
  supabase/     Client construction
  test/         Shared Vitest setup and the in-memory Supabase fake
supabase/
  schema.sql    GENERATED — every migration, consolidated and idempotent
  reset.sql     Destructive: drop and recreate `public` with Supabase's grants
  repair.sql    Non-destructive: create-if-not-exists / add-column-if-not-exists
  seed.sql      Sample PG for one owner
  _access.sql   Source fragment for schema.sql: admins, is_admin(), policies
  migrations/   001-006, the source of truth for the schema
tests/e2e/      Playwright smoke test
public/
  manifest.webmanifest, sw.js, icons
scripts/
  build-schema.mjs   Regenerates supabase/schema.sql from the migrations
  audit-sql.mjs      Cross-checks the SQL against what the frontend uses
  generate-icons.mjs Regenerates the PNG icons without any dependencies
```

## Privacy

No analytics and no telemetry. Network requests go to your own Supabase project, plus
the WhatsApp links you tap yourself.
