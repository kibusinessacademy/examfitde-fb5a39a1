#!/usr/bin/env node
/**
 * Memory-Sync Guard v1.2 — prüft, ob in `.lovable/memory/index.md` referenzierte
 * SSOT-/Queue-/Audit-/Registry-Systeme in `src/lib/governance/known-systems.ts`
 * registriert sind.
 *
 * Exit 1 bei missing != [] (nach Allowlist).
 * Exit 0 bei vollständiger Abdeckung.
 *
 * Keine DB-Writes, keine Supabase-Imports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

const MEM_FILE = path.resolve(process.cwd(), '.lovable/memory/index.md');
const ALLOWLIST_FILE = path.resolve(process.cwd(), 'scripts/guards/known-systems-memory-sync.allowlist.json');

if (!fs.existsSync(MEM_FILE)) {
  console.error(`❌ Memory file fehlt: ${MEM_FILE}`);
  process.exit(2);
}

const memText = fs.readFileSync(MEM_FILE, 'utf8');

let allowlist = [];
if (fs.existsSync(ALLOWLIST_FILE)) {
  try {
    const raw = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
    allowlist = Array.isArray(raw.allowed) ? raw.allowed : [];
  } catch (e) {
    console.error(`⚠️  Allowlist nicht parsebar: ${e.message}`);
  }
}

let syncMemoryAgainstRegistry;
try {
  const esbuild = await import('esbuild');
  const entry = path.resolve(process.cwd(), 'src/lib/governance/memory-sync.ts');
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  ({ syncMemoryAgainstRegistry } = await import(dataUrl));
} catch (err) {
  console.error('❌ Failed to load memory-sync.ts');
  console.error(err?.message ?? err);
  process.exit(2);
}

const result = syncMemoryAgainstRegistry(memText, allowlist);

console.log('\n──────── Known-Systems / Memory Sync ────────');
console.log(`  covered: ${result.covered.length}`);
console.log(`  allowed (waiver): ${result.allowed.length}`);
console.log(`  missing: ${result.missing.length}`);

if (result.missing.length > 0) {
  console.error('\n❌ Folgende Memory-Refs fehlen in known-systems.ts (oder in Allowlist):');
  for (const m of result.missing) console.error(`  - ${m}`);
  console.error('\nFix:');
  console.error('  1) Füge sie als KnownSystem in src/lib/governance/known-systems.ts hinzu, ODER');
  console.error('  2) Trage sie in scripts/guards/known-systems-memory-sync.allowlist.json (allowed[]) ein');
  console.error('     wenn es sich um lokale Helfer/Trigger/Views unterhalb der SSOT-Ebene handelt.');
  process.exit(1);
}

console.log('\n✅ Memory ↔ Registry vollständig synchron.');
process.exit(0);
