#!/usr/bin/env node
/**
 * Architectural Continuity Guard v1.1 — CI/Preflight Static Guard
 *
 * Liest eine Proposal-JSON-Datei (oder mehrere) und ruft reviewArchitecture
 * deterministisch auf. Exit 1 bei verdict=blocked. Exit 1 bei hard finding
 * ohne reuse_strategy. Exit 0 sonst.
 *
 * Usage:
 *   node --experimental-strip-types scripts/guards/architecture-continuity-guard.mjs <file.json> [more.json …]
 *   node --experimental-strip-types scripts/guards/architecture-continuity-guard.mjs --dir docs/examples/architecture-proposals
 *
 * Keine DB-Writes, keine Supabase-Imports, deterministisches Ergebnis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: architecture-continuity-guard.mjs <proposal.json> [more.json …] | --dir <dir>');
  process.exit(2);
}

function collectFiles(args) {
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dir') {
      const dir = args[++i];
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.json')) files.push(path.join(dir, f));
      }
    } else {
      files.push(a);
    }
  }
  return files;
}

const files = collectFiles(args);

// Bundle architecture-review.ts on the fly via esbuild (avoids Node TS loader edge cases)
let reviewArchitecture;
try {
  const esbuild = await import('esbuild');
  const entry = path.resolve(process.cwd(), 'src/lib/governance/architecture-review.ts');
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
  ({ reviewArchitecture } = await import(dataUrl));
} catch (err) {
  console.error('❌ Failed to load architecture-review.ts');
  console.error(err?.message ?? err);
  process.exit(2);
}

let hardFail = false;
const summary = [];

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  let proposal;
  try {
    proposal = JSON.parse(raw);
  } catch (e) {
    console.error(`❌ ${file}: invalid JSON — ${e.message}`);
    hardFail = true;
    continue;
  }
  const review = reviewArchitecture(proposal);

  // Hard finding ohne Reuse-Strategie?
  const hardOrphans = review.findings.filter(
    (f) => f.severity === 'block' && !f.recommended_reuse_path && !f.required_bridge_target,
  );

  const blockReasons = review.findings
    .filter((f) => f.severity === 'block')
    .map((f) => `${f.rule}: ${f.message}`);

  const status = review.verdict === 'blocked'
    ? '❌ BLOCKED'
    : review.verdict === 'review_required'
      ? '⚠️  REVIEW'
      : '✅ APPROVED';

  console.log(`\n${status}  ${file}`);
  console.log(`  proposal: ${proposal.kind} "${proposal.name}"`);
  if (review.findings.length === 0) {
    console.log('  no findings');
  } else {
    for (const f of review.findings) {
      const sev = f.severity === 'block' ? '✗' : f.severity === 'warn' ? '~' : 'i';
      console.log(`  [${sev}] ${f.rule}: ${f.message}`);
      if (f.evidence) console.log(`        evidence: ${f.evidence}`);
      if (f.recommended_reuse_path) console.log(`        reuse:    ${f.recommended_reuse_path}`);
      if (f.required_bridge_target) console.log(`        bridge:   ${f.required_bridge_target}`);
    }
  }

  if (review.verdict === 'blocked') {
    hardFail = true;
  }
  if (hardOrphans.length > 0) {
    console.error(`  ⛔ ${hardOrphans.length} hard finding(s) ohne reuse_strategy — Architektur-Bruch.`);
    hardFail = true;
  }

  summary.push({ file, verdict: review.verdict, blockReasons });
}

console.log('\n──────── Summary ────────');
for (const s of summary) {
  console.log(`  ${s.verdict.padEnd(16)} ${s.file}`);
}

if (hardFail) {
  console.error('\n❌ Architectural Continuity Guard FAILED.');
  process.exit(1);
}
console.log('\n✅ Architectural Continuity Guard passed.');
process.exit(0);
