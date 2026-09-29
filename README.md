# PG Manager

A mobile-first paying-guest (PG) management app. Track tenants, rent dues, identity
proofs and payments — and it all runs offline on the device.

Built as a client-only app: no server, no accounts, no network calls. Everything is
stored in the browser on the phone or laptop it is used on.

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
  and owner details, app PIN, sample data, and a full data wipe.
- **App lock** — a 4–6 digit PIN gate with a 12-hour session.
- **Installable PWA** — add to the home screen, launches full screen, works offline.

## Tech

- [React 19](https://react.dev) + [Vite](https://vite.dev)
- [Tailwind CSS v4](https://tailwindcss.com) (via `@tailwindcss/vite`)
- [React Router 7](https://reactrouter.com)
- [React Hook Form](https://react-hook-form.com) + [Zod](https://zod.dev)
- [Day.js](https://day.js.org) for all date maths
- [idb](https://github.com/jakearchibald/idb) for image storage
- Context + hooks for state (no external state library needed)
- [Vitest](https://vitest.dev) + Testing Library + fake-indexeddb for tests

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL. On a phone, use the network URL so the app runs on
the same device you will actually use it on.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the full test suite once |
| `npm run test:watch` | Watch mode |
| `npm run lint` | Lint with [oxlint](https://oxc.rs/docs/guide/usage/linter.html) |

## How the data is stored

| Data | Where | Format |
| --- | --- | --- |
| Tenants, payments, settings | `localStorage` | JSON |
| Photos and identity proofs | `IndexedDB` | Base64 JPEG, max 800px edge |

Tenant records and settings are written to `localStorage`; images go to `IndexedDB`
because base64 images are far too large for a comfortable `localStorage` experience.
The service layer is `async` throughout, so swapping in a real backend later means
reimplementing `src/services/*` rather than rewriting the pages.

Photos are compressed in the browser (longest edge capped at 800px, JPEG) before
being stored, to keep them small enough for a few dozen tenants.

## Routes

| Route | Screen |
| --- | --- |
| `/` | Dashboard and tenant list |
| `/admission` | New tenant admission |
| `/customers` | Tenant directory |
| `/customer/:id` | Tenant details |
| `/settings` | Settings |
| `/login` | PIN gate |

## Testing

```bash
npm test
```

- `src/utils/dateLogic.test.js` — rent due-date maths, month-end clamping, statuses.
- `src/utils/validation.test.js` — admission/edit schema rules and input sanitisers.
- `src/services/customerService.test.js` — CRUD, payment roll-forward, sorting, totals.
- `src/pages/pages.test.jsx` — real components against the real service layer:
  seeding, colour coding, filtering, the payment flow, and form validation.
- `src/App.test.jsx` — smoke tests for the router, the auth gate, the layout and the
  lazily loaded routes.

Service tests run in the plain `node` environment with a small `localStorage`
stand-in; the page tests opt into `happy-dom` with a per-file docblock.

## Notes and limitations

- **The PIN is not encryption.** It is a salted SHA-256 hash kept in
  `localStorage` and stops casual snooping on a shared device — it does not
  protect the underlying data. Treat it as a screen lock, not a safe.
- **Aadhaar and PAN numbers are stored in plain text** on the device, because the
  app needs to show them. Do not use a shared or untrusted device for real
  identity documents, and wipe the data (Settings → *Erase all tenant data*) before
  disposing of a device.
- **No backup.** Clearing browser data, site data, or uninstalling the PWA deletes
  everything. There is no sync and no export.
- The first PIN you set is the PIN — there is no default and no recovery if it is
  forgotten, so clear site data to start over.
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
  hooks/        useImageUrl, useInstallPrompt
  pages/        Dashboard, Admission, CustomerDetails, Customers, Settings, Login
  services/     Storage, customers, settings, seeding, images, auth
  utils/        Date maths, formatting, validation, image compression
  test/         Shared Vitest setup
public/
  manifest.webmanifest, sw.js, icons
scripts/
  generate-icons.mjs   Regenerates the PNG icons without any dependencies
```

## Privacy

No analytics, no telemetry, no network requests. The app makes no outbound calls
other than the WhatsApp links you tap yourself.
