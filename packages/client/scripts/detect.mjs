#!/usr/bin/env node
// tokens:detect — enforce the design-token discipline mechanically.
//
// Rules over src/components/** (and src/styles.css, which must not exist):
//   1. No bare color literals in CSS (hex / rgb() / rgba() / hsl()).
//   2. No `--prim-*` references (Tier 1 primitives are tokens.css-internal).
//   3. No inline <svg> icons (icons must come from ui/icons.ts → Phosphor).
// src/styles/tokens.css is the sole author of colors and primitives.
//
// Exit code 0 = clean; 1 = violations found.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = join(fileURLToPath(import.meta.url), '..', '..');
const componentsDir = join(clientRoot, 'src', 'components');
const legacyStyles = join(clientRoot, 'src', 'styles.css');

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;
const PRIM_RE = /--prim-/;
const SVG_RE = /<svg\b/i;

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(css|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const violations = [];

if (existsSync(legacyStyles)) {
  violations.push(`src/styles.css still exists — it must be removed (styles live in src/components/**)`);
}

for (const file of walk(componentsDir)) {
  const rel = relative(clientRoot, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  const isCss = file.endsWith('.css');

  if (isCss) {
    // Strip comments before scanning — `--prim-*` appears in the header note.
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
    if (COLOR_RE.test(stripped)) {
      const hits = stripped.split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => COLOR_RE.test(line))
        .map(({ line, i }) => `  ${rel}:${i + 1}: ${line.trim()}`);
      violations.push(`${rel}: bare color literal(s) — use a Tier 2 token:\n${hits.join('\n')}`);
    }
    if (PRIM_RE.test(stripped)) {
      violations.push(`${rel}: references a --prim-* value — Tier 1 is tokens.css-internal`);
    }
  } else {
    if (SVG_RE.test(text)) {
      const hits = text.split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => SVG_RE.test(line))
        .map(({ line, i }) => `  ${rel}:${i + 1}: ${line.trim()}`);
      violations.push(`${rel}: inline <svg> icon — import from ui/icons.ts (Phosphor) instead:\n${hits.join('\n')}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`\n❌ token discipline violated (${violations.length}):\n`);
  for (const v of violations) console.error(`• ${v}\n`);
  process.exit(1);
}

console.log('✅ token discipline clean — no bare colors, no --prim- refs, no inline svg icons.');
process.exit(0);
