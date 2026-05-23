import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock the executor BEFORE importing hook
vi.mock('../p18-heal-executor.functions', () => ({
  recordP18Detection: vi.fn(async (drift: any) => ({
    idempotency_key: drift.idempotency_key,
    drift_type: drift.drift_type,
    status: 'detected',
  })),
}));

import { runP18DetectionForArchitectureReview } from '../p18-review-hook';
import * as executor from '../p18-heal-executor.functions';
import type { ArchitectureReview } from '../architecture-review';

const FIXED_NOW = new Date('2026-05-23T08:00:00.000Z');

function makeReview(
  verdict: ArchitectureReview['verdict'],
  findings: ArchitectureReview['findings'] = [],
): ArchitectureReview {
  return {
    proposal: { kind: 'rpc', name: 'admin_test_x', purpose: 'test purpose' },
    reuse_candidates: [],
    bridge_targets: [],
    findings,
    duplication_risk: [],
    governance_risk: [],
    migration_strategy: [],
    recommended_extension_points: [],
    verdict,
  };
}

describe('P18 Auto-Trigger-Hook (P20 Cut 0A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approved + 0 findings → keine Mutation, kein Noise', async () => {
    const r = await runP18DetectionForArchitectureReview(makeReview('approved'), {
      now: FIXED_NOW,
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('approved_no_findings');
    expect(r.recorded_keys).toEqual([]);
    expect(executor.recordP18Detection).not.toHaveBeenCalled();
  });

  it('blocked + findings → Detection idempotent recorded', async () => {
    const review = makeReview('blocked', [
      {
        rule: 'NO_PARALLEL_SYSTEMS',
        severity: 'block',
        message: 'duplicate audit',
        evidence: 'evidence',
        matched_known_systems: [],
      },
    ]);
    const r = await runP18DetectionForArchitectureReview(review, { now: FIXED_NOW });
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe('recorded');
    expect(r.recorded_keys.length).toBeGreaterThan(0);
    expect(executor.recordP18Detection).toHaveBeenCalled();
  });

  it('zweimal aufgerufen → identische idempotency_keys (Ledger-Idempotenz)', async () => {
    const review = makeReview('review_required', [
      {
        rule: 'EXTEND_EXISTING',
        severity: 'warn',
        message: 'extend existing',
        evidence: 'ev',
        matched_known_systems: [],
      },
    ]);
    const a = await runP18DetectionForArchitectureReview(review, { now: FIXED_NOW });
    const b = await runP18DetectionForArchitectureReview(review, { now: FIXED_NOW });
    expect(a.recorded_keys.sort()).toEqual(b.recorded_keys.sort());
  });

  it('Fehler im RPC → wird gesammelt, blockiert nicht', async () => {
    (executor.recordP18Detection as any).mockRejectedValueOnce(new Error('boom'));
    const review = makeReview('blocked', [
      {
        rule: 'NO_PARALLEL_SYSTEMS',
        severity: 'block',
        message: 'x',
        evidence: 'e',
        matched_known_systems: [],
      },
    ]);
    const r = await runP18DetectionForArchitectureReview(review, { now: FIXED_NOW });
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].error).toContain('boom');
  });
});

describe('Pureness Contract (Static Guards)', () => {
  it('p18-orchestrator.ts bleibt pure (kein Supabase-Import)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/lib/governance/p18-orchestrator.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/from ['"]@\/integrations\/supabase/);
    expect(src).not.toMatch(/supabase\.rpc/);
    expect(src).not.toMatch(/supabase\.from/);
  });

  it('architecture-review.ts bleibt pure (kein Supabase-Import)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/lib/governance/architecture-review.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/from ['"]@\/integrations\/supabase/);
    expect(src).not.toMatch(/supabase\.rpc/);
  });

  it('p18-review-hook.ts mutiert NUR via existierende RPC', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/lib/governance/p18-review-hook.ts'),
      'utf8',
    );
    // Nur indirect via executor — kein direkter supabase-Aufruf
    expect(src).not.toMatch(/from ['"]@\/integrations\/supabase/);
    expect(src).not.toMatch(/supabase\.rpc/);
    // Muss bestehende RPC-Bridge nutzen
    expect(src).toMatch(/recordP18Detection/);
  });
});
