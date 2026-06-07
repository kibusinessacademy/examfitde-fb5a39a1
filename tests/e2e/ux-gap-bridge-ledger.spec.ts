/**
 * E2E — ux-gap-scan + ux-gap-bridge + P18 ledger write
 * ────────────────────────────────────────────────────
 * Verifies the full bridge end-to-end:
 *   1. Synthesize a UxGapFinding batch (deterministic, isolated test fingerprint)
 *   2. POST → ux-gap-bridge edge function with service-role bearer
 *   3. Read back via admin_get_p18_ledger RPC → assert row exists with
 *      drift_type='ux_gap' + matching idempotency_key
 *
 * Skips when service-role key is not available (no destructive prod writes
 * outside the dedicated test fingerprint namespace).
 */
import { test, expect } from '@playwright/test';
import { SERVICE_KEY, SUPABASE_URL } from './helpers/service-key';

const HAS_KEY = Boolean(SERVICE_KEY && SUPABASE_URL);

test.describe('ux-gap-bridge ledger E2E', () => {
  test.skip(!HAS_KEY, 'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL');

  test('POST → ledger row visible via admin_get_p18_ledger', async () => {
    const detectedAt = new Date().toISOString();
    const day = detectedAt.slice(0, 10);
    const testId = `e2e-${Date.now()}`;
    const surface = `__e2e__/ux-gap-bridge`;
    const expectedFp = `ux:${surface}:${testId}`.replace(/[^a-zA-Z0-9:_\-/]/g, '_').slice(0, 200);
    const expectedKey = `p18:ux_gap:${expectedFp}:ux-gap-bridge-v1:${day}`;

    const findings = [
      {
        id: testId,
        surface,
        message: 'E2E synthetic ux_gap finding — safe to ignore',
        severity: 'P0' as const,
        source: 'static-surface-scan' as const,
        detected_at: detectedAt,
        matched_systems: [surface],
        recommended_action: 'no-op',
      },
      // invalid row to exercise per-row isolation
      { id: 'broken', surface: null, message: 'x', severity: 'P0', source: 'static-surface-scan', detected_at: detectedAt },
    ];

    // 1) POST → bridge
    const post = await fetch(`${SUPABASE_URL}/functions/v1/ux-gap-bridge`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ findings }),
    });
    const body = await post.json();
    expect(post.status, `bridge http ${post.status}: ${JSON.stringify(body).slice(0, 300)}`).toBe(200);
    expect(body.received).toBe(findings.length);
    expect(body.recorded).toBeGreaterThanOrEqual(1);
    // invalid row must be reported as failed but not crash the batch
    expect(body.invalid).toBe(1);

    // 2) Read back via admin RPC
    const lookup = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_get_p18_ledger`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_limit: 100, p_drift_type: 'ux_gap' }),
    });
    const rows = await lookup.json();
    expect(lookup.status, `rpc http ${lookup.status}: ${JSON.stringify(rows).slice(0, 300)}`).toBe(200);
    const match = (rows as any[]).find((r) => r.idempotency_key === expectedKey);
    expect(match, `expected ledger row with key=${expectedKey}`).toBeTruthy();
    expect(match.drift_type).toBe('ux_gap');
    expect(match.severity).toBe('block');
    expect(match.target_fingerprint).toBe(expectedFp);
  });
});
