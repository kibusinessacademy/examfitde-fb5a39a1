import { describe, it, expect } from 'vitest';
import {
  mapP18DriftToGilSignal,
  mapDriftSignalToGil,
  KNOWN_BRIDGEABLE_DRIFT_TYPES,
} from '../p18-gil-bridge';
import { runP18Cut1 } from '../p18-orchestrator';

const baseInput = {
  idempotency_key: 'p18:ssot_conflict:abc12345:p18-cut1.v1.0:2026-05-23',
  drift_type: 'ssot_conflict',
  severity: 'block' as const,
  trigger_source: 'architecture-review-done',
  target_fingerprint: 'abc12345',
  policy_version: 'p18-cut1.v1.0',
  matched_system_ids: ['user_roles', 'profiles'],
  message: 'Two SSOTs collide for roles.',
};

describe('p18-gil-bridge', () => {
  it('maps deterministically — block→critical, info→info, warn→warning', () => {
    const block = mapP18DriftToGilSignal({ ...baseInput, severity: 'block' });
    const warn = mapP18DriftToGilSignal({ ...baseInput, severity: 'warn' });
    const info = mapP18DriftToGilSignal({ ...baseInput, severity: 'info' });
    expect(block.ok && block.draft.severity).toBe('critical');
    expect(warn.ok && warn.draft.severity).toBe('warning');
    expect(info.ok && info.draft.severity).toBe('info');
  });

  it('produces signal_type=internal_drift and source=p18', () => {
    const r = mapP18DriftToGilSignal(baseInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.signal_type).toBe('internal_drift');
    expect(r.draft.source).toBe('p18');
    expect(r.draft.payload.idempotency_key).toBe(baseInput.idempotency_key);
    expect(r.draft.payload.evidence_refs).toEqual([`p18:ledger:${baseInput.idempotency_key}`]);
    expect(r.draft.payload.tags).toContain('p18');
    expect(r.draft.payload.tags).toContain('internal_drift');
    expect(r.draft.payload.tags).toContain('ssot_conflict');
  });

  it('does NOT leak raw proposals or oversized payloads', () => {
    const huge = 'x'.repeat(5000);
    const r = mapP18DriftToGilSignal({ ...baseInput, message: huge });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // payload only carries whitelisted keys
    const keys = Object.keys(r.draft.payload).sort();
    expect(keys).toEqual([
      'confidence',
      'drift_type',
      'evidence_refs',
      'idempotency_key',
      'matched_system_ids',
      'policy_version',
      'tags',
      'target_fingerprint',
      'trigger_source',
    ]);
    expect(r.draft.summary.length).toBeLessThanOrEqual(600);
  });

  it('redacts secret-shaped tokens from the summary', () => {
    const r = mapP18DriftToGilSignal({
      ...baseInput,
      message: 'Leak sb_publishable_3Z80G1ZZqFaK and eyJabcdefghij1234567890.payload.signaturepart',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.summary).not.toMatch(/sb_publishable/);
    expect(r.draft.summary).not.toMatch(/eyJabcdefghij/);
    expect(r.draft.summary).toContain('[redacted]');
  });

  it('idempotency_key is preserved verbatim in the payload', () => {
    const r1 = mapP18DriftToGilSignal(baseInput);
    const r2 = mapP18DriftToGilSignal(baseInput);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.draft.payload.idempotency_key).toBe(r2.draft.payload.idempotency_key);
    expect(r1.draft.payload.confidence).toBe(r2.draft.payload.confidence);
    expect(r1.draft.severity).toBe(r2.draft.severity);
  });

  it('rejects unknown drift_type', () => {
    const r = mapP18DriftToGilSignal({ ...baseInput, drift_type: 'something_new_invented' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unknown_drift_type');
  });

  it('rejects invalid input (missing key)', () => {
    const r = mapP18DriftToGilSignal({ ...baseInput, idempotency_key: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_input');
  });

  it('all KNOWN_BRIDGEABLE_DRIFT_TYPES from Cut1 are mappable', () => {
    for (const dt of KNOWN_BRIDGEABLE_DRIFT_TYPES) {
      const r = mapP18DriftToGilSignal({ ...baseInput, drift_type: dt });
      expect(r.ok).toBe(true);
    }
  });

  it('integration: runP18Cut1 → mapDriftSignalToGil yields stable bridge results', () => {
    const result = runP18Cut1({ knownSystemsChange: {}, now: new Date('2026-05-23T00:00:00Z') });
    for (const sig of result.signals.slice(0, 5)) {
      const r = mapDriftSignalToGil(sig);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.draft.payload.idempotency_key).toBe(sig.idempotency_key);
    }
  });
});
