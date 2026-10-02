# Project Architecture & Setup Guide: PG Manager

**PG Manager** is a mobile-first, production-grade **Paying Guest (PG) & Hostel Management System** built with **React 19**, **Vite**, **Tailwind CSS v4**, and **Supabase (PostgreSQL + RLS + Storage + Auth)**. It provides end-to-end management of tenants, room allocations, automated rent cycles, electricity meter splitting, ID verification (Aadhaar/PAN), expenses, asset registers, weekly mess menus, and instant WhatsApp reminders with UPI payment links.

---

## 1. Project Overview & Core Features

```text
                                  +------------------------------------+
                                  |       React 19 + Vite + PWA        |
                                  |  (Desktop / Mobile Home Screen)    |
                                  +-----------------+------------------+
                                                    |
                                          [ React Router 7 ]
                                                    |
         +--------------------+---------------------+--------------------+--------------------+
         |                    |                     |                    |                    |
   [ Dashboard ]       [ Operations ]        [ Rooms & Beds ]     [ Transactions ]       [ Settings ]
   - Red/Amber/Green   - Complaints          - Total vs Occupied  - Rent & Late Fees     - Pricing & Terms
   - WhatsApp Notice   - Move-out Notices    - Floor-wise Views   - Electricity Bills    - Team Allow-List
   - Fast Search       - Enquiries/Visitors  - Room Inventories   - Ledger Reversal      - Data Backup/Restore
         |                    |                     |                    |                    |
         +--------------------+---------------------+--------------------+--------------------+
                                                    |
                                    [ Service Layer Facade ]
                        (customerService, roomService, operationsService, etc.)
                                                    |
                                      [ src/services/supabase.js ]
                                         (Single Network Boundary)
                                                    |
                            +-----------------------+-----------------------+
                            |                                               |
                   [ Supabase Postgres ]                          [ Supabase Storage ]
                - 20 Relational Tables                         - Private 'identity-docs'
                - Row-Level Security (RLS)                     - Signed URLs (6-hour expiry)
                - Stored Procedures / RPCs                     - Namespaced by PG Owner
                - Team Allow-List (admins)
```

### Key Capabilities
* **Traffic-Light Rent Status**: Real-time status indicators (Red = Overdue, Amber = Due within 5 days, Green = Paid/Healthy) sorted automatically with the most overdue tenants at the top.
* **One-Tap WhatsApp Dues Reminder**: Prefills tenant name, outstanding balance, electricity dues, and UPI QR link directly into WhatsApp.
* **Atomic Rent Ledger & Lifecycle**: Payments are processed using atomic PostgreSQL stored procedures (`SECURITY DEFINER` RPCs), preventing balance race conditions and automatically advancing due dates by one month.
* **Electricity Meter Splitting**: Room-level meter reading tracking with automatic per-tenant bill splitting.
* **Document & Tenant Verification**: React Hook Form + Zod validation with Aadhaar (Verhoeff checksum algorithm) and PAN format checks; identity documents are stored in a private Supabase bucket and served via expiring signed URLs.
* **Multi-User Access Control (Allow-List)**: Only pre-approved emails in the `admins` table can access the PG's ledger, with role levels: `owner`, `admin`, and `staff`.
* **PWA & Offline-Resilient**: Offline detection banner, app shell caching via `public/sw.js`, and per-route error boundaries so a failure in one section never crashes the entire application.

---

## 2. Explanation of Project Structures ("Statures")

### A. Codebase & Directory Structure

| Directory / File | Description |
| :--- | :--- |
| `src/pages/` | 14 top-level route pages (e.g. Dashboard, Admission, Rooms, Settings). |
| `src/components/` | Modular UI components (e.g. CustomerList, PaymentDialog, ErrorBoundary). |
| `src/context/` | React Context state management (AuthContext, DataContext, NotificationContext). |
| `src/services/` | Backend abstraction layer. **Only** `supabase.js` communicates with Supabase. |
| `src/utils/` | Pure business logic (date math, ledger calculations, Zod validation, PDF generation). |
| `supabase/` | Database scripts: migrations `001` to `006`, `schema.sql`, `reset.sql`, `repair.sql`, `seed.sql`. |
| `scripts/` | Build & audit tools (`build-schema.mjs`, `audit-sql.mjs`). |

---

### B. Database Schema & Data Models

The database consists of **20 tables**, **3 analytical views**, and multiple stored procedures:

* **Tables**: `admins`, `rooms`, `customers`, `rent_cycles`, `transactions`, `light_bills`, `expenses`, `complaints`, etc.
* **Views**:
  * `rent_cycles_view`: Denormalizes customer details with current cycle status, balances, and days overdue.
  * `light_bills_view`: Aggregates customer names, room numbers, and unpaid electricity balances.
  * `rooms_occupancy`: Real-time bed occupancy calculations (active tenants count vs. room capacity).
* **Storage Bucket**: `identity-docs` (private bucket) restricted to the ledger owner via Supabase RLS.

---

### C. Status Lifecycle & Calculation Logic

#### 1. Tenant Rent Statuses
Evaluated dynamically based on the tenant's current cycle `due_date`:
* **OVERDUE (Red)**: Tenant has missed the payment due date. Placed at the top of lists.
* **UPCOMING (Amber)**: Rent is due within 5 days.
* **PAID / HEALTHY (Green)**: Rent settled for current cycle.

#### 2. Payment & Month Clamping Mechanics
* Full payments recorded via `record_rent_payment()` settle the active `rent_cycle` and create the next cycle with `due_date = due_date + 1 month`.
* Day clamping is handled gracefully (e.g., joining on January 31st yields next due dates on February 28/29th, then March 31st).

#### 3. Room & Operational Statuses
* **Rooms**: `Vacant`, `Partially Occupied`, `Full`.
* **Complaints**: `Open` -> `In Progress` -> `Resolved`.
* **Notices**: `Submitted` -> `Pending Inspection` -> `Cleared` / `Vacated`.

---

### D. Security & Access Control Structure

Access control is enforced at the database layer using PostgreSQL Row Level Security (RLS):
1. **Allow-List Table (`admins`)**: Holds approved emails (`owner`, `admin`, `staff`).
2. **`is_admin()` Function**: Checks if the user's email exists in the `admins` table.
3. **`app_scope_user_id()` Function**:
   * Ensures that regardless of which team member signs in, all database queries automatically resolve to the **owner's partition ID**.
   * Unlisted users receive `NULL`, granting zero access, and are rejected.
4. **Bootstrap Owner Claiming**: When `admins` is completely empty, the very first user who signs in automatically claims project ownership.

---

## 3. Step-by-Step Setup Guide

### Step 1: Prerequisites
* **Node.js**: v20.x or higher installed (`node -v`)
* **npm**: v10.x or higher (`npm -v`)
* **Supabase Account**: Free account at [supabase.com](https://supabase.com)

---

### Step 2: Install Node Dependencies

```bash
npm install
```

---

### Step 3: Setup Supabase Backend

1. Create a project at [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor** -> **New query**.
3. Copy the contents of `supabase/schema.sql`, paste it, and click **Run**.
4. Verify that the private storage bucket `identity-docs` is created:
   * Go to **Storage**. If `identity-docs` is missing, click **New bucket**, name it `identity-docs`, ensure **Public Bucket is OFF**, and save.
5. *(Optional)* Run `supabase/seed.sql` to populate demo data.

---

### Step 4: Configure Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-public-key>
```

---

### Step 5: Configure Supabase Authentication

1. Go to **Authentication** -> **Providers** -> Enable **Email**.
2. Go to **Authentication** -> **URL Configuration**.
3. Under **Redirect URLs**, add `http://localhost:5173`.
4. Set **Site URL** to `http://localhost:5173`.
5. *(Optional)* Setup Google OAuth if required using Google Cloud Console and paste the Client ID/Secret into Supabase's Google provider settings.

---

### Step 6: Start the Development Server

```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

---

### Step 7: Initial Login & Claiming Ownership

1. Open `http://localhost:5173/login`.
2. Sign up or sign in using your email.
3. As the first user, you will automatically claim **Master Owner** status.
4. To add staff, go to **Settings** -> **Team** inside the app.

---

## 4. Verification & Testing

Ensure full health and correctness of the codebase by running:

```bash
npm run verify
```
This runs the linter, builds the app, executes the Vitest suite, and audits the SQL schema against the frontend usage.

---

## 5. Production Deployment (Vercel)

The repository includes `vercel.json` configured with SPA rewrites and caching headers.
1. Push your repository to GitHub / GitLab.
2. Import the project into Vercel.
3. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel's settings.
4. Deploy and add the live Vercel URL to your Supabase Redirect URLs.
