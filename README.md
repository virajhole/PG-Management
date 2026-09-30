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
- **Accounts** — email and password sign-in instead of a device-local PIN, so the same
  ledger is reachable from any browser and Row Level Security keeps it private.
- **Installable PWA** — add to the home screen, launches full screen, caches the app
  shell for offline use.

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
| `npm run lint` | Lint with [oxlint](https://oxc.rs/docs/guide/usage/linter.html) |

## Setting up Supabase

### 1. Create the schema

In your Supabase project, either paste `supabase/migrations/001_init.sql` into the SQL
editor and run it, or apply it with the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

The migration creates four tables (`customers`, `rent_cycles`, `light_bills`,
`transactions`), a single-row `settings` table, two read views (`rent_cycles_view`,
`light_bills_view`), the private `tenant-images` bucket, and Row Level Security
policies on everything. Every policy scopes rows to `auth.uid()`, so the anon key
alone can read nothing.

### 2. Configure sign-in

**Authentication → Providers → Email**: enable it. Turning off *Confirm email* makes
sign-up instant, which is convenient for a single-owner app; leaving it on means a
new account has to confirm before it can sign in.

### 3. Point the app at it

```bash
cp .env.example .env
```

```dotenv
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Both come from **Project Settings → API**. The anon key is safe to ship in a browser
bundle — Row Level Security is what protects the data, not the key. Never put the
`service_role` key in `.env`.

Without these the app still builds and runs, and the sign-in screen explains that the
project is not configured.

### 4. Deploy

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

## How the data is stored

| Data | Where | Notes |
| --- | --- | --- |
| Tenants, rent cycles, light bills, transactions | Postgres, per account | `user_id = auth.uid()`, RLS on every table |
| Settings | Postgres, one row per account | `id = 'app'` |
| Photos and identity proofs | Private Storage bucket | Read only through 6-hour signed URLs |

All access goes through one module, `src/services/supabase.js`. The service modules
above it (`customerService`, `cycleService`, `lightBillService`, `transactionService`,
`settingsService`, `imageService`, `authService`) never talk to the network
themselves, and the pages never import the data layer directly. Swapping the backend
means changing one file.

Money mutations are Postgres functions (`SECURITY DEFINER`, re-scoped by `auth.uid()`
inside) rather than a read-then-write in JavaScript, so two devices cannot
interleave a payment into an inconsistent balance:

- `preview_rent_payment` — what an amount will do before you commit it
- `record_rent_payment` — apply it, settle the cycle and open the next one
- `save_light_bill` / `record_light_bill_payment`
- `delete_transaction` — reverse it and restore the cycle and credit
- `import_backup` / `wipe_all`

Storage objects are namespaced `<user-id>/c/<customer-id>/...`, so a path from one
account can never resolve in another.

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
| `/settings` | Settings |
| `/login` | Sign in / create account |

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
- `src/App.test.jsx` — smoke tests for the router, the auth gate, the layout and the
  lazily loaded routes.

Tests run against `src/test/supabaseFake.js`, an in-memory stand-in that exposes the
same surface as the real data layer (including the same `p_`-prefixed RPC argument
names). Each test seeds its own data — the app itself no longer seeds demo data on
boot.

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
  components/   Reusable UI: layout, customer list, form fields, dialogs, icons
  context/      Auth, data and toast providers
  hooks/        useImageUrl, useInstallPrompt, useOnlineStatus
  pages/        Dashboard, Admission, CustomerDetails, Customers, Transactions,
                Settings, Login
  services/     supabase.js (the only module that talks to Supabase) plus the
                service facades above it
  supabase/     Client construction
  test/         Shared Vitest setup and the in-memory Supabase fake
supabase/
  migrations/   001_init.sql — schema, RLS, storage and RPCs
public/
  manifest.webmanifest, sw.js, icons
scripts/
  generate-icons.mjs   Regenerates the PNG icons without any dependencies
```

## Privacy

No analytics and no telemetry. Network requests go to your own Supabase project, plus
the WhatsApp links you tap yourself.
