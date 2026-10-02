/**
 * Consolidates the ordered migrations plus the access-control section into one
 * runnable file, supabase/schema.sql.
 *
 *   node scripts/build-schema.mjs
 *
 * The migrations stay the source of truth for the schema; this only performs
 * the two rewrites that turn a per-account schema into an allow-listed one and
 * makes the result re-runnable:
 *
 *   1. `user_id = auth.uid()`  ->  `user_id = public.app_scope_user_id()`
 *      (and `default auth.uid()`, `:= auth.uid()` and the storage folder
 *      prefix the same way). Every owner-scope check in a policy, an RPC or a
 *      storage rule now routes through one resolver, so adding the team is a
 *      single change rather than ninety.
 *
 *   2. Every `create policy` is preceded by `drop policy if exists`, because
 *      Postgres has no `create policy if not exists` and a re-run would
 *      otherwise abort on the first duplicate.
 *
 * Nothing else is rewritten: the SQL bodies, the views, the RPC signatures and
 * the grants are copied through untouched, so the consolidated file cannot
 * drift from the migrations it came from.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_DIR = 'supabase/migrations';
const ACCESS_FILE = 'supabase/_access.sql';
const OUT_FILE = 'supabase/schema.sql';

const migrations = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const ORDER = [
  '001_init.sql',
  '002_rooms_and_lifecycle.sql',
  '003_operations.sql',
  '004_tenant_tools.sql',
  '005_optional_features.sql',
  '006_late_fee_rpc.sql',
];

const ordered = ORDER.filter((f) => migrations.includes(f));
const unexpected = migrations.filter((f) => !ORDER.includes(f));
if (unexpected.length) {
  console.warn(`Note: ${unexpected.join(', ')} not in the explicit order list, appending sorted.`);
  ordered.push(...unexpected.sort());
}

const SCOPE = 'public.app_scope_user_id()';

/** The exact rewrites described in the header comment. */
const REWRITES = [
  // 1. Policy bodies.
  [/using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\);/g,
    `using (user_id = ${SCOPE}) with check (user_id = ${SCOPE});`],
  // 2. Column defaults.
  [/default auth\.uid\(\)/g, `default ${SCOPE}`],
  // 3. RPC locals: `v_user uuid := auth.uid();`
  [/(:=\s*)auth\.uid\(\);/g, `$1${SCOPE};`],
  // 4. Remaining inline comparisons inside function bodies.
  [/(\.user_id = )auth\.uid\(\)/g, `$1${SCOPE}`],
  [/(\buser_id = )auth\.uid\(\)/g, `$1${SCOPE}`],
  [/(\(storage\.foldername\(name\)\)\[1\] = )auth\.uid\(\)::text/g, `$1${SCOPE}::text`],
];

function transform(sql) {
  let out = sql;

  for (const [pattern, replacement] of REWRITES) out = out.replace(pattern, replacement);

  // Drop-then-create so the file is idempotent.
  out = out.replace(
    /^create policy ("[^"]+") on ([a-z_.]+)/gim,
    (_, name, table) => `drop policy if exists ${name} on ${table};\ncreate policy ${name} on ${table}`,
  );

  return out;
}

/** Splits a migration into its leading comment block and its body. */
function split(sql) {
  const lines = sql.split('\n');
  const banner = [];
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('--') || lines[i].trim() === '')) {
    banner.push(lines[i]);
    i += 1;
  }
  return { banner: banner.join('\n').trim(), body: lines.slice(i).join('\n').trim() };
}

const header = `-- ============================================================================
-- PG Manager - complete database schema
--
-- GENERATED FILE - do not edit by hand.
-- Rebuild with:  node scripts/build-schema.mjs
--
-- This is every migration (001-006) plus the access-control section, in
-- dependency order and safe to run more than once. Everything is
-- "create ... if not exists" / "drop policy if exists", so you can paste the
-- whole file into the Supabase SQL editor against a fresh project, against one
-- that already has the old migrations applied, or twice in a row.
--
-- To wipe and start over:      supabase/reset.sql, then this file.
-- To upgrade without losing data: supabase/repair.sql.
-- To add demo rows:            supabase/seed.sql.
--
-- Sections
--   1. 001 core ledger (customers, rent cycles, light bills, transactions, settings)
--   2. 002 rooms, occupancy and the tenant lifecycle
--   3. 003 complaints, notices, enquiries, visitors
--   4. 004 agreements, rent revisions, meter readings, late fees
--   5. 005 assets and mess menu
--   6. 006 record_flat_transaction RPC
--   7. Access control: admins allow-list, is_admin(), app_scope_user_id()
-- ============================================================================
`;

const parts = [];
for (const file of ordered) {
  const sql = readFileSync(join(MIGRATION_DIR, file), 'utf8');
  const { body } = split(sql);
  parts.push(
    `-- ############################################################################\n` +
      `-- # SECTION: ${file}\n` +
      `-- ############################################################################\n\n` +
      transform(body),
  );
}

const access = transform(readFileSync(ACCESS_FILE, 'utf8'));
parts.push(
  `-- ############################################################################\n` +
    `-- # SECTION: access control (admins allow-list, is_admin)\n` +
    `-- ############################################################################\n\n` +
    access,
);

writeFileSync(OUT_FILE, `${header}\n${parts.join('\n\n')}\n`, 'utf8');

const lines = readFileSync(OUT_FILE, 'utf8').split('\n').length;
console.log(`${OUT_FILE}: ${ordered.length + 1} sections, ${lines} lines`);