/**
 * Cross-checks the SQL in supabase/ against what the frontend actually reads
 * and writes. Run it after editing either side:
 *
 *   node scripts/audit-sql.mjs
 *
 * It reports tables the app uses but the schema does not define, columns the
 * app writes but the table does not have, indexes/constraints that are missing,
 * RPCs the app calls that no function provides, and storage policies that do
 * not mention is_admin().
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SQL_FILES = existsSync('supabase/schema.sql')
  ? ['supabase/schema.sql']
  : readdirSync('supabase/migrations').map((f) => join('supabase/migrations', f));

const sql = SQL_FILES.map((f) => readFileSync(f, 'utf8')).join('\n');

/** Table name (snake_case) -> Set of columns, from CREATE TABLE + ADD COLUMN. */
function tableColumns(name) {
  return tableColumnsFrom(sql, name);
}

/** The same scan against an explicit SQL blob, so two files can be compared. */
function tableColumnsFrom(source, name) {
  const create = new RegExp(`create table if not exists public\\.${name}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i').exec(source);
  const cols = new Set();
  if (create) {
    for (const line of create[1].split('\n')) {
      const m = /^\s{2}([a-z_][a-z0-9_]*)\s/.exec(line);
      if (m) cols.add(m[1]);
    }
  }
  for (const m of source.matchAll(
    new RegExp(`alter table (?:if exists )?public\\.${name}\\s+add column if not exists\\s+([a-z_][a-z0-9_]*)`, 'gi'),
  )) {
    cols.add(m[1]);
  }
  return cols.size ? cols : null;
}

function definedFunctions() {
  return new Set(
    [...sql.matchAll(/create or replace function\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]),
  );
}

// --------------------------------------------------------------- frontend map

const TABLES = {
  customers: 'customers',
  cycles: 'rent_cycles',
  lightBills: 'light_bills',
  transactions: 'transactions',
  settings: 'settings',
  rooms: 'rooms',
  roomHistory: 'room_history',
  expenses: 'expenses',
  complaints: 'complaints',
  notices: 'notices',
  enquiries: 'enquiries',
  visitors: 'visitors',
  rentRevisions: 'rent_revisions',
  meterReadings: 'meter_readings',
  agreements: 'agreements',
  lateFees: 'late_fees',
  assets: 'assets',
  messMenu: 'mess_menu',
  admins: 'admins',
};

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|jsx)$/.test(p)) files.push(p);
  }
})('src');

const snake = (v) => String(v).replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** Words that look like keys after `||` but are values. */
const NOT_A_KEY = new Set(['null', 'undefined', 'true', 'false', 'return', 'const', 'let', 'await']);

/** Object-literal keys passed to insertRow/updateRow, per table. */
function writtenColumns() {
  const out = {};
  for (const file of files) {
    // Blank out string/template bodies first so a brace inside one cannot throw
    // the balance scan off.
    const src = readFileSync(file, 'utf8').replace(/(['`])(?:\\.|(?!\1)[\s\S])*?\1/g, '""');
    const re = /(?:insertRow|updateRow)\(\s*TABLES\.(\w+)\s*,\s*(?=\{)/g;
    let m;
    while ((m = re.exec(src))) {
      const table = TABLES[m[1]] ?? m[1];
      // The regex only matches when the payload is an inline object literal, so
      // a builder call (insertRow(TABLES.x, makeRow(...))) is skipped instead
      // of sweeping up whatever brace comes next.
      const start = m.index + m[0].length;
      let depth = 0;
      let end = start;
      for (let i = start; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
          depth -= 1;
          if (depth === 0) { end = i; break; }
        }
      }
      const body = src.slice(start, end + 1);
      out[table] ??= new Set();
      for (const k of body.matchAll(/(?:^|[{,\s])([a-zA-Z][\w]*)\s*[:,]/g)) {
        if (!NOT_A_KEY.has(k[1])) out[table].add(snake(k[1]));
      }
    }
  }
  return out;
}

/** Every RPC name passed to rpc(...) plus the read helpers. */
function calledRpcs() {
  const names = new Set();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\brpc\(\s*'([a-z_]+)'/g)) names.add(m[1]);
  }
  return names;
}

// ------------------------------------------------------------------- report

let problems = 0;
const fail = (msg) => {
  problems += 1;
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

console.log(`Auditing ${SQL_FILES.length} SQL file(s) against ${files.length} source files\n`);

console.log('Tables the app writes to');
for (const [table, cols] of Object.entries(writtenColumns())) {
  const defined = tableColumns(table);
  if (!defined) {
    fail(`${table} is not defined in the schema`);
    continue;
  }
  const missing = [...cols].filter((c) => !defined.has(c));
  if (missing.length) fail(`${table} is missing column(s): ${missing.join(', ')}`);
  else pass(`${table} (${cols.size} columns written)`);
}

console.log('\nTables the app reads');
for (const table of new Set(Object.values(TABLES))) {
  if (!tableColumns(table)) fail(`${table} is read by the app but not defined in the schema`);
}

console.log('\nRPCs the app calls');
const functions = definedFunctions();
for (const name of calledRpcs()) {
  if (!functions.has(name)) fail(`rpc ${name}() has no matching SQL function`);
}
pass(`${calledRpcs().size} rpc call(s) checked`);

console.log('\nViews the app selects from');
for (const view of ['rent_cycles_view', 'light_bills_view', 'rooms_occupancy']) {
  if (!new RegExp(`create (or replace )?view (if not exists )?public\\.${view}\\b`, 'i').test(sql)) {
    fail(`view ${view} is missing`);
  } else pass(`view ${view}`);
}

console.log('\nSeed file');
if (existsSync('supabase/seed.sql')) {
  const seed = readFileSync('supabase/seed.sql', 'utf8');
  let seedProblems = 0;
  for (const m of seed.matchAll(/insert into public\.(\w+)\s*\(([\s\S]*?)\)/gi)) {
    const table = m[1];
    const defined = tableColumns(table);
    if (!defined) {
      fail(`seed.sql inserts into ${table}, which the schema does not define`);
      seedProblems += 1;
      continue;
    }
    const cols = m[2]
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const missing = cols.filter((c) => !defined.has(c));
    if (missing.length) {
      fail(`seed.sql inserts unknown column(s) into ${table}: ${missing.join(', ')}`);
      seedProblems += 1;
    }
  }
  if (!seedProblems) pass('every seeded column exists');
} else {
  console.log('  --    seed.sql not present, skipped');
}

console.log('\nRepair file');
if (existsSync('supabase/repair.sql')) {
  const repair = readFileSync('supabase/repair.sql', 'utf8');
  // Anything destructive in a file whose whole promise is "never drops data".
  const destructive = [...repair.matchAll(/^\s*(drop\s+(table|schema|column|view)|truncate|delete\s+from)/gim)];
  const tolerated = destructive.filter((line) => !/drop constraint if exists|drop policy if exists/i.test(line[0]));
  if (tolerated.length) {
    fail(`repair.sql contains destructive statements: ${tolerated.map((t) => t[0].trim()).join(' | ')}`);
  } else pass('no destructive statements (only drop constraint / drop policy if exists)');

  // repair.sql promises to bring a project that already has 001-002 up to the
  // current schema. That promise is only kept honest by diffing it against the
  // migrations it is *meant* to replace - everything 003 and later. Checking it
  // against the whole schema instead would demand it recreate the base tables,
  // which it deliberately does not do. This diff is how `customers.birthday`
  // went missing for a while.
  const migrationDir = 'supabase/migrations';
  const migrations = existsSync(migrationDir)
    ? readdirSync(migrationDir).filter((f) => f.endsWith('.sql')).sort()
    : [];
  const cut = migrations.findIndex((f) => f.startsWith('002'));
  const laterMigrations = cut === -1 ? migrations : migrations.slice(cut + 1);
  let drift = 0;
  if (!laterMigrations.length) {
    console.log('  --    migrations 003+ not found, drift check skipped');
  } else {
    const lateSql = laterMigrations
      .map((f) => readFileSync(join(migrationDir, f), 'utf8'))
      .join('\n');

    const lateTables = new Set(
      [...lateSql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]),
    );
    for (const table of lateTables) {
      const defined = tableColumnsFrom(repair, table);
      if (!defined) {
        fail(`repair.sql never creates table ${table} (added in 003+)`);
        drift += 1;
        continue;
      }
      // Columns declared inline in the migration must survive into repair.sql's
      // copy of the table, or a repaired project quietly gets a narrower table.
      const declared = tableColumnsFrom(lateSql, table) ?? new Set();
      const missingInline = [...declared].filter((c) => !defined.has(c));
      if (missingInline.length) {
        fail(`repair.sql's ${table} is missing column(s): ${missingInline.join(', ')}`);
        drift += 1;
      }
    }

    const lateColumns = new Set(
      [...lateSql.matchAll(
        /alter table (?:if exists )?public\.(\w+)\s+add column (?:if not exists )?([a-z_][a-z0-9_]*)/gi,
      )].map((m) => `${m[1]}.${m[2]}`),
    );
    for (const key of lateColumns) {
      const [table, column] = key.split('.');
      const defined = tableColumnsFrom(repair, table);
      if (!defined?.has(column)) {
        fail(`repair.sql is missing ${key} (added in 003+)`);
        drift += 1;
      }
    }
    if (!drift) {
      pass(
        `repair.sql covers all ${lateTables.size} table(s) and ${lateColumns.size} column(s) added by ${laterMigrations.join(', ')}`,
      );
    }
  }
} else {
  console.log('  --    repair.sql not present, skipped');
}

console.log('\nAccess control');
if (!/create table if not exists public\.admins\b/i.test(sql)) fail('the admins allowlist table is missing');
else pass('admins table');
if (!/create or replace function public\.is_admin\(\)/i.test(sql)) fail('is_admin() is missing');
else pass('is_admin()');

// Every table with a user_id column must have a policy mentioning is_admin().
const ownedTables = [...sql.matchAll(/user_id\s+uuid\s+not null default/g)].length;
const policyCount = [...sql.matchAll(/create policy/gi)].length;
if (policyCount < ownedTables) fail(`only ${policyCount} policies for ${ownedTables} owner-scoped tables`);
else pass(`${policyCount} RLS policies across ${ownedTables} owner-scoped tables`);

if (!/identity-docs/.test(sql)) fail('the private identity-docs bucket policy is missing');
else pass('storage bucket policy for identity-docs');

console.log(problems === 0 ? '\nNo mismatches found.' : `\n${problems} problem(s) found.`);
process.exit(problems === 0 ? 0 : 1);