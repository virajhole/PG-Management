/**
 * One-off codemod: move the remaining hand-written light-mode palette classes
 * onto the semantic tokens in src/index.css.
 *
 * Run with: node scripts/theme-tokens.mjs
 *
 * It only touches className string literals, and it leaves `text-white` alone -
 * that stays white on coloured buttons in both themes.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';

// Dark mode is opt-in per element, so a class only gets swapped when the token
// has an equivalent in both themes.
const MAP = [
  // text
  [/\btext-slate-900\b/g, 'text-ink'],
  [/\btext-slate-800\b/g, 'text-ink'],
  [/\btext-slate-700\b/g, 'text-ink'],
  [/\btext-slate-600\b/g, 'text-ink-muted'],
  [/\btext-slate-500\b/g, 'text-ink-subtle'],
  [/\btext-slate-400\b/g, 'text-ink-subtle'],
  // surfaces
  [/\bbg-white\b/g, 'bg-raised'],
  [/\bbg-slate-50\b/g, 'bg-sunken'],
  [/\bbg-slate-100\b/g, 'bg-sunken'],
  [/\bbg-slate-200\b/g, 'bg-line-strong'],
  // borders
  [/\bborder-slate-100\b/g, 'border-line'],
  [/\bborder-slate-200\b/g, 'border-line'],
  [/\bborder-slate-300\b/g, 'border-line-strong'],
  // hover fills that read as surfaces
  [/\bhover:bg-slate-50\b/g, 'hover:bg-sunken'],
  [/\bhover:bg-slate-100\b/g, 'hover:bg-sunken'],
  [/\bhover:bg-slate-200\b/g, 'hover:bg-line-strong'],
  [/\bhover:text-slate-600\b/g, 'hover:text-ink'],
  [/\bhover:text-slate-700\b/g, 'hover:text-ink'],
  [/\bhover:text-slate-900\b/g, 'hover:text-ink'],
  // disabled
  [/\bdisabled:bg-slate-100\b/g, 'disabled:bg-sunken'],
  [/\bdisabled:text-slate-500\b/g, 'disabled:text-ink-subtle'],
  // placeholders
  [/\bplaceholder:text-slate-400\b/g, 'placeholder:text-ink-subtle'],
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(jsx|js)$/.test(entry) && !/\.test\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

let changed = 0;
for (const file of walk(SRC)) {
  const before = readFileSync(file, 'utf8');
  let after = before;
  for (const [pattern, replacement] of MAP) after = after.replace(pattern, replacement);
  if (after !== before) {
    writeFileSync(file, after);
    changed += 1;
    console.log('updated', file);
  }
}
console.log(`\n${changed} file(s) changed`);
