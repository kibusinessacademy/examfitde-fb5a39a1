import { describe, it, expect } from 'vitest';
import {
  classifyFailCluster,
  classifyStatus,
  sanitizeSample,
  FAIL_CLUSTER_KEYS,
  FAIL_CLUSTER_LABELS,
} from '@/contracts/failClusters';

describe('failClusters — classifier', () => {
  it('detects lf_self_fail by code', () => {
    expect(classifyFailCluster({ last_error_code: 'LF_REPAIR_RESCHEDULE_LOCK' })).toBe('lf_self_fail');
    expect(classifyFailCluster({ last_error_code: 'NO_JOBS_DISPATCHED' })).toBe('lf_self_fail');
    expect(classifyFailCluster({ last_error_code: 'ACTIVE_FANOUT_FOR_LF' })).toBe('lf_self_fail');
  });

  it('detects lf_self_fail by message', () => {
    expect(classifyFailCluster({ error: 'no_jobs_dispatched after 3 retries' })).toBe('lf_self_fail');
    expect(classifyFailCluster({ last_error: 'active_fanout_for_lf still pending' })).toBe('lf_self_fail');
  });

  it('detects missing_blueprint_id', () => {
    expect(classifyFailCluster({ last_error_code: 'MISSING_BLUEPRINT_ID' })).toBe('missing_blueprint_id');
    expect(classifyFailCluster({ error: 'HTTP 400 missing blueprint_id' })).toBe('missing_blueprint_id');
  });

  it('detects ai_gateway_bypass', () => {
    expect(classifyFailCluster({ error: 'GOOGLE_AI_API_KEY not set' })).toBe('ai_gateway_bypass');
    expect(classifyFailCluster({ last_error: 'invalid model id gemini-pro' })).toBe('ai_gateway_bypass');
  });

  it('detects phk_nested_kill', () => {
    expect(classifyFailCluster({ last_error_code: 'PRE_HEARTBEAT_KILL_TERMINAL' })).toBe('phk_nested_kill');
    expect(classifyFailCluster({ error: 'job was killed (was killed (was killed))' })).toBe('phk_nested_kill');
  });

  it('detects sealed_course_retry', () => {
    expect(classifyFailCluster({ last_error_code: 'SEALED_COURSE' })).toBe('sealed_course_retry');
    expect(classifyFailCluster({ error: 'sealed_course — refusing retry' })).toBe('sealed_course_retry');
  });

  it('detects generic_http_500 last', () => {
    expect(classifyFailCluster({ error: 'HTTP 502 bad gateway' })).toBe('generic_http_500');
    expect(classifyFailCluster({ error: 'status 503 from upstream' })).toBe('generic_http_500');
    expect(classifyFailCluster({ error: 'internal server error' })).toBe('generic_http_500');
  });

  it('returns null for unknown errors', () => {
    expect(classifyFailCluster({ error: 'totally random failure' })).toBeNull();
    expect(classifyFailCluster({})).toBeNull();
  });

  it('lf_self_fail wins over generic_http_500', () => {
    // ensures cluster ordering is correct
    expect(
      classifyFailCluster({ error: 'no_jobs_dispatched HTTP 500 internal server error' }),
    ).toBe('lf_self_fail');
  });

  it('all keys have labels', () => {
    for (const k of FAIL_CLUSTER_KEYS) {
      expect(FAIL_CLUSTER_LABELS[k]).toBeTruthy();
    }
  });
});

describe('failClusters — status thresholds', () => {
  it('green when count_24h is 0', () => {
    expect(classifyStatus(0, 0)).toBe('green');
    expect(classifyStatus(0, 100)).toBe('green');
  });

  it('critical when count_24h >= 10', () => {
    expect(classifyStatus(10, 10)).toBe('critical');
    expect(classifyStatus(50, 50)).toBe('critical');
  });

  it('critical when 24h spikes above 2x prior 4d-daily average', () => {
    // prior 4d average = (20-5)/4 = 3.75 → floor 3 → 2x = 6 → 5d window has 20 fails, 24h has 5 → 5>6? no => watch
    expect(classifyStatus(5, 20)).toBe('watch');
    // 24h=8, prior4d=(20-8)/4=3 → 2x=6 → 8>6 critical
    expect(classifyStatus(8, 20)).toBe('critical');
  });

  it('watch when 24h within prior 4d baseline', () => {
    // prior4d=(40-3)/4=9, 2x=18, 3>18? no, 3>=10? no => watch
    expect(classifyStatus(3, 40)).toBe('watch');
    expect(classifyStatus(5, 50)).toBe('watch');
  });
});

describe('failClusters — sanitizeSample', () => {
  it('redacts bearer tokens', () => {
    expect(sanitizeSample('Authorization: Bearer abc.def-ghi'))
      .toMatch(/\[REDACTED\]/);
  });

  it('redacts sk- secrets', () => {
    expect(sanitizeSample('error using sk-12345678abcdef key'))
      .toMatch(/\[REDACTED\]/);
  });

  it('redacts JWTs', () => {
    expect(sanitizeSample('jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 invalid'))
      .toMatch(/\[REDACTED\]/);
  });

  it('redacts API_KEY assignments', () => {
    const out = sanitizeSample('GOOGLE_API_KEY=AIzaSyXXX failed');
    expect(out).toMatch(/\[REDACTED\]/);
    expect(out).not.toContain('AIzaSyXXX');
  });

  it('truncates to 240 chars', () => {
    const long = 'x'.repeat(500);
    expect(sanitizeSample(long).length).toBe(240);
  });

  it('handles null/undefined safely', () => {
    expect(sanitizeSample(null)).toBe('');
    expect(sanitizeSample(undefined)).toBe('');
  });

  it('collapses whitespace', () => {
    expect(sanitizeSample('a   b\n\nc')).toBe('a b c');
  });
});
