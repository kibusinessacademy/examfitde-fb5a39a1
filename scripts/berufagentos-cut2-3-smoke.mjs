#!/usr/bin/env node
/**
 * BerufAgentOS Cut 2.3 — Continuous Outcome Intelligence (Read-Only) Smoke
 * Verifiziert: Tabelle/Enums/Helper, 4 RPCs, 3 Audit-Contracts, UI, Route, Client-Lib, Memory.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const errs = [];
const ok = [];
const check = (label, cond) => (cond ? ok : errs).push(label);

// Client lib
const lib = fs.readFileSync(path.join(ROOT, 'src/lib/berufs-ki/outcome.ts'), 'utf8');
check('client: listOutcomeIntelligence', lib.includes('listOutcomeIntelligence'));
check('client: recordOutcomeIntelligence', lib.includes('recordOutcomeIntelligence'));
check('client: classifyOutcomeIntelligence', lib.includes('classifyOutcomeIntelligence'));
check('client: getOutcomeIntelligenceSummary', lib.includes('getOutcomeIntelligenceSummary'));
check('client: OutcomeIntelligenceKind type', lib.includes('OutcomeIntelligenceKind'));
check('client: 6 kinds union', ['workflow_intelligence','outcome_drift','ux_friction','governance_risk','seo_intelligence','support_signal']
  .every((k) => lib.includes(`"${k}"`)));
check('client: 4 statuses', ['open','acknowledged','muted','resolved_observed'].every((s) => lib.includes(`"${s}"`)));

// UI page
const page = fs.readFileSync(path.join(ROOT, 'src/pages/admin/berufs-ki/OutcomeIntelligencePage.tsx'), 'utf8');
check('UI: page exports default', page.includes('export default function OutcomeIntelligencePage'));
check('UI: outcome radar tiles', /Outcome.?Radar|Radar/i.test(page));
check('UI: filters (kind+status)', page.includes('kind') && page.includes('status'));
check('UI: empty state', /Noch keine|Keine Findings|Empty/i.test(page));
check('UI: error state', /Fehler|error/i.test(page));
check('UI: loading state', /Skeleton|loading|Lädt/i.test(page));

// Route
const routes = fs.readFileSync(path.join(ROOT, 'src/routes/AppRoutes.tsx'), 'utf8');
check('route: lazy import', routes.includes('OutcomeIntelligencePage = lazyRetry'));
check('route: path registered', routes.includes('berufs-ki/outcome-intelligence'));

// Migration / SQL artifacts
const migDir = path.join(ROOT, 'supabase/migrations');
const migFiles = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql'));
const migCorpus = migFiles
  .filter((f) => /continuous_outcome_intelligence|outcome_intelligence/i.test(f) || f.startsWith('20260527085943'))
  .map((f) => fs.readFileSync(path.join(migDir, f), 'utf8'))
  .join('\n');
check('migration: outcome_intelligence_findings table', /CREATE TABLE[^;]*outcome_intelligence_findings/i.test(migCorpus));
check('migration: fn_outcome_intelligence_priority', /fn_outcome_intelligence_priority/.test(migCorpus));
check('migration: admin_record_outcome_intelligence', /admin_record_outcome_intelligence/.test(migCorpus));
check('migration: admin_classify_outcome_intelligence', /admin_classify_outcome_intelligence/.test(migCorpus));
check('migration: admin_list_outcome_intelligence', /admin_list_outcome_intelligence/.test(migCorpus));
check('migration: admin_get_outcome_intelligence_summary', /admin_get_outcome_intelligence_summary/.test(migCorpus));
check('migration: 3 audit contracts', ['outcome_intelligence_recorded','outcome_intelligence_status_changed','outcome_intelligence_rescored']
  .every((c) => migCorpus.includes(c)));
check('migration: RLS enabled', /ENABLE ROW LEVEL SECURITY/i.test(migCorpus));

// Memory
const memIdx = fs.readFileSync(path.join(ROOT, '.lovable/memory/index.md'), 'utf8');
check('memory: index references cut 2.3', /v2-cut-2-3-continuous-outcome-intelligence/.test(memIdx));
const featDoc = path.join(ROOT, '.lovable/memory/features/berufs-ki/v2-cut-2-3-continuous-outcome-intelligence.md');
check('memory: feature doc exists', fs.existsSync(featDoc));

console.log('\n──── BerufAgentOS Cut 2.3 Smoke ────');
ok.forEach((l) => console.log('✓', l));
errs.forEach((l) => console.error('✗', l));
console.log(`\n${ok.length} passed, ${errs.length} failed`);
process.exit(errs.length === 0 ? 0 : 1);
