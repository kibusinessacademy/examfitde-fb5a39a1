#!/usr/bin/env node
/**
 * audit-write-contract-guard
 *
 * Verhindert, dass neue SQL-Migrationen direkt in `auto_heal_log` schreiben.
 * SSOT-Schreibweg ist `public.fn_emit_audit(...)`.
 *
 * Baseline-Allowlist: bestehende Migrationen vor Contract-Einführung (Datum-Cutoff).
 * Neue Migrationen (>= CUTOFF) müssen fn_emit_audit benutzen.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';
// Migrationen ab diesem Timestamp müssen fn_emit_audit verwenden.
// 2026-05-26: ops_audit_contract Bootstrap abgeschlossen — alle vorherigen
// Direct-Inserts sind historisch und bereits in Production deployed.
const CUTOFF = '20260526000000';
const DIRECT_INSERT = /\bINSERT\s+INTO\s+(public\.)?auto_heal_log\b/i;

const offenders = [];
for (const f of readdirSync(MIGRATIONS_DIR).sort()) {
  if (!f.endsWith('.sql')) continue;
  const ts = f.slice(0, 14);
  if (ts < CUTOFF) continue;
  const body = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
  if (DIRECT_INSERT.test(body) && !body.includes('fn_emit_audit')) {
    offenders.push(f);
  }
}

if (offenders.length) {
  console.error('❌ audit-write-contract-guard: direct INSERT INTO auto_heal_log ohne fn_emit_audit:');
  for (const f of offenders) console.error('   -', f);
  console.error('   Fix: nutze SELECT public.fn_emit_audit(_action_type, ...);');
  process.exit(1);
}
console.log('✅ audit-write-contract-guard: ok');
