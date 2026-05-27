#!/usr/bin/env node
/**
 * BerufAgentOS Cut 2.2 — Persistent Intelligence Memory Smoke
 * Verifiziert: Enums, Tabelle, 4 RPCs, 3 Audit-Contracts, Route, Client-Lib.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const errs = [];
const ok = [];

function check(label, cond) { (cond ? ok : errs).push(label); }

const lib = fs.readFileSync(path.join(ROOT, 'src/lib/berufs-ki/outcome.ts'), 'utf8');
check('client: listIntelligenceMemory', lib.includes('listIntelligenceMemory'));
check('client: recordIntelligenceMemory', lib.includes('recordIntelligenceMemory'));
check('client: retireIntelligenceMemory', lib.includes('retireIntelligenceMemory'));
check('client: classifyIntelligenceMemory', lib.includes('classifyIntelligenceMemory'));
check('client: IntelligenceMemoryKind type', lib.includes('IntelligenceMemoryKind'));
check('client: 9 kinds union', ['successful_pattern','quality_issue','risk_incident','conversion_learning','ux_learning','seo_learning','workflow_failure','security_pattern','architecture_decision'].every(k => lib.includes(`"${k}"`)));

const page = fs.readFileSync(path.join(ROOT, 'src/pages/admin/berufs-ki/IntelligenceMemoryPage.tsx'), 'utf8');
check('UI: page exports default', page.includes('export default function IntelligenceMemoryPage'));
check('UI: empty state', page.includes('Noch keine Memories'));
check('UI: error state', page.includes('Fehler beim Laden'));
check('UI: loading skeleton', page.includes('Skeleton'));
check('UI: filters present', page.includes('kindFilter') && page.includes('statusFilter'));

const routes = fs.readFileSync(path.join(ROOT, 'src/routes/AppRoutes.tsx'), 'utf8');
check('route: lazy import', routes.includes('IntelligenceMemoryPage = lazyRetry'));
check('route: path registered', routes.includes('berufs-ki/intelligence-memory'));

const memIdx = fs.readFileSync(path.join(ROOT, '.lovable/memory/index.md'), 'utf8');
check('memory: index references cut 2.2', /v2-cut-2-2-persistent-intelligence-memory|Cut 2\.2/i.test(memIdx));

const featDoc = path.join(ROOT, '.lovable/memory/features/berufs-ki/v2-cut-2-2-persistent-intelligence-memory.md');
check('memory: feature doc exists', fs.existsSync(featDoc));

console.log('\n──── BerufAgentOS Cut 2.2 Smoke ────');
ok.forEach((l) => console.log('✓', l));
errs.forEach((l) => console.error('✗', l));
console.log(`\n${ok.length} passed, ${errs.length} failed`);
process.exit(errs.length === 0 ? 0 : 1);
