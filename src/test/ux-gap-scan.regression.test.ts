/**
 * Regression tests for scripts/ux-gap-scan.mjs
 * ─────────────────────────────────────────────
 * Locks the hydration-drift classification + P0 emission contract so that
 * future tweaks to the heuristic rules can't silently regress what the
 * Daily customer-reality-gate + ux-gap-bridge consume.
 *
 * Strategy: spawn the real scanner against a synthetic cwd that contains
 * only qa-state/pre-customer/*.json fixtures. We deliberately do NOT
 * mock the script — we test it end-to-end exactly as CI runs it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/ux-gap-scan.mjs');

function makeTmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-gap-scan-'));
  fs.mkdirSync(path.join(dir, 'qa-state', 'pre-customer'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reality-results', 'findings'), { recursive: true });
  return dir;
}

function writeFixture(root: string, id: string, detail: string) {
  fs.writeFileSync(
    path.join(root, 'qa-state', 'pre-customer', `${id}.json`),
    JSON.stringify({ id, status: 'fail', detail, ts: new Date().toISOString() }),
  );
}

function runScan(root: string) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), UX_GAP_REPORT_DIR: root };
  delete env.PGHOST; // ensure DB scan is skipped deterministically
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  const reportPath = path.join(root, 'ux-gap-report.json');
  const report = fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : null;
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, report };
}

describe('ux-gap-scan hydration-drift regression', () => {
  let root: string;

  beforeAll(() => {
    root = makeTmpRoot();
    // Canonical 4 hydration-drift signals — keep in sync with
    // HYDRATION_DRIFT_HINTS in scripts/ux-gap-scan.mjs.
    writeFixture(root, 'P01_homepage', 'problems=1');
    writeFixture(root, 'P02_find_beruf', 'links=0');
    writeFixture(root, 'P03_open_course', 'ttc=696ms url=NONE');
    writeFixture(root, 'P04_pricing', 'hasPrice=false');
    // Non-drift failure: must still be picked up as P0 but with the
    // generic re-run recommendation, not a hydration-drift hint.
    writeFixture(root, 'P05_cta_click', 'no-course');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('exits 1 when P0 findings are present and writes a report', () => {
    const { status, report, stderr } = runScan(root);
    expect(stderr, stderr).not.toMatch(/crashed/);
    expect(status).toBe(1);
    expect(report).toBeTruthy();
    expect(report.summary.by_severity.P0).toBeGreaterThanOrEqual(5);
    expect(report.summary.db_signal.skipped).toBe(true);
  });

  it.each([
    ['P01_homepage', '/', 'hero CTA'],
    ['P02_find_beruf', '/berufe', 'Beruf-Karten-Liste'],
    ['P03_open_course', '/berufe', 'Kurs-Discovery-Link'],
    ['P04_pricing', '/preise', '€-Preis'],
  ])('classifies %s as HYDRATION-DRIFT with route %s', (id, route, elementHint) => {
    const { report } = runScan(root);
    const f = report.findings.find((x: any) => x.surface === id);
    expect(f, `finding for ${id} missing`).toBeTruthy();
    expect(f.severity).toBe('P0');
    expect(f.source).toBe('pre-customer-reality');
    expect(f.recommended_action).toMatch(/HYDRATION-DRIFT/);
    expect(f.recommended_action).toContain(route);
    expect(f.recommended_action).toContain(elementHint);
    // Repair guidance must steer toward visible default render,
    // not toward re-running the gate.
    expect(f.recommended_action).toMatch(/Default-Render/);
    expect(f.recommended_action).not.toMatch(/Re-run gate/);
  });

  it('keeps non-drift failures as P0 but falls back to generic re-run action', () => {
    const { report } = runScan(root);
    const f = report.findings.find((x: any) => x.surface === 'P05_cta_click');
    expect(f).toBeTruthy();
    expect(f.severity).toBe('P0');
    expect(f.recommended_action).toMatch(/Re-run gate/);
    expect(f.recommended_action).not.toMatch(/HYDRATION-DRIFT/);
  });

  it('emits one P0 ux-gap-*.json per finding for the bridge to consume', () => {
    runScan(root);
    const dir = path.join(root, 'reality-results', 'findings');
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('ux-gap-'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      expect(j.severity).toBe('P0');
      expect(j.source).toBe('ux-gap-scan');
      expect(j.finding).toBeTruthy();
    }
  });

  it('returns 0 findings + exit 0 when no failing fixtures exist', () => {
    const empty = makeTmpRoot();
    try {
      const { status, report } = runScan(empty);
      expect(status).toBe(0);
      expect(report.summary.by_severity.P0).toBe(0);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// P2 Surface Hygiene heuristic — locks the tightened static-surface-scan
// rules so future tweaks can't silently flag legitimate empty states
// with CTAs or stop flagging real "coming soon" lies.
// ─────────────────────────────────────────────────────────────────────
describe('ux-gap-scan static-surface heuristic', () => {
  function writePage(root: string, relPath: string, content: string) {
    const abs = path.join(root, 'src', 'pages', relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  function runScanOn(root: string) {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), UX_GAP_REPORT_DIR: root };
    delete env.PGHOST;
    spawnSync(process.execPath, [SCRIPT], { cwd: root, env, encoding: 'utf8' });
    return JSON.parse(fs.readFileSync(path.join(root, 'ux-gap-report.json'), 'utf8'));
  }

  it('flags "Coming Soon" copy unconditionally', () => {
    const root = makeTmpRoot();
    try {
      writePage(root, 'CSPage.tsx', `export default () => <div>Coming Soon — bald da</div>;`);
      const r = runScanOn(root);
      const f = r.findings.find((x: any) => x.surface.endsWith('CSPage.tsx'));
      expect(f, 'coming-soon must be flagged').toBeTruthy();
      expect(f.severity).toBe('P2');
      expect(f.message).toMatch(/coming soon/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags "Bald verfügbar" copy unconditionally', () => {
    const root = makeTmpRoot();
    try {
      writePage(root, 'BVPage.tsx', `export default () => <button disabled>Bald verfügbar</button>;`);
      const r = runScanOn(root);
      const f = r.findings.find((x: any) => x.surface.endsWith('BVPage.tsx'));
      expect(f).toBeTruthy();
      expect(f.message).toMatch(/coming soon/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does NOT flag "Noch keine X" empty states that have a CTA', () => {
    const root = makeTmpRoot();
    try {
      writePage(
        root,
        'OkEmpty.tsx',
        `import { Link } from 'react-router-dom';
         export default () => (
           <div>
             <p>Noch keine Rechnungen vorhanden.</p>
             <Link to="/shop">Zum Shop</Link>
           </div>
         );`,
      );
      const r = runScanOn(root);
      const f = r.findings.find((x: any) => x.surface.endsWith('OkEmpty.tsx'));
      expect(f, 'empty state with CTA must NOT be flagged').toBeFalsy();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('DOES flag "Noch keine X" empty states without any actionable element', () => {
    const root = makeTmpRoot();
    try {
      writePage(
        root,
        'DeadEnd.tsx',
        `export default () => <div><p>Noch keine Daten vorhanden.</p></div>;`,
      );
      const r = runScanOn(root);
      const f = r.findings.find((x: any) => x.surface.endsWith('DeadEnd.tsx'));
      expect(f, 'dead-end empty state must be flagged').toBeTruthy();
      expect(f.message).toMatch(/without actionable CTA/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does NOT flag recovery-fallback when a Link/Button is present', () => {
    const root = makeTmpRoot();
    try {
      writePage(
        root,
        'TutorOk.tsx',
        `import { Link } from 'react-router-dom';
         import { Button } from '@/components/ui/button';
         export default () => {
           reportEntryFallbackView('tutor', 'recovery');
           return <Button asChild><Link to="/berufe">Beruf auswählen</Link></Button>;
         };`,
      );
      const r = runScanOn(root);
      const f = r.findings.find((x: any) => x.surface.endsWith('TutorOk.tsx'));
      expect(f, 'recovery surface with CTA must NOT be flagged').toBeFalsy();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('DOES flag recovery-fallback when no Link/Button fallback exists', () => {
    const root = makeTmpRoot();
    try {
      writePage(
        root,
        'TutorBad.tsx',
        `export default () => {
           reportEntryFallbackView('tutor', 'recovery');
           return <p>Etwas ist schiefgegangen.</p>;
         };`,
      );
      const r = runScanOn(root);
      const f = r.findings.find((x: any) => x.surface.endsWith('TutorBad.tsx'));
      expect(f, 'recovery surface without fallback must be flagged').toBeTruthy();
      expect(f.message).toMatch(/Recovery surface/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
