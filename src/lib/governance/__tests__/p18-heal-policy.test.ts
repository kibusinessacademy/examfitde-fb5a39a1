/**
 * P18 Cut 2 — Bounded Heal Policy Tests (PURE)
 *
 * Keine Supabase-Imports. Keine DB. Deterministisch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  P18_HEAL_WHITELIST,
  isP18HealActionAllowed,
  deriveAllowedHealActions,
  isQualityGateRelevant,
  buildKnownSystemSuggestion,
  validateP18HealRequest,
  buildAuditMetadata,
  type HealAction,
} from '../p18-heal-policy';
import type { DriftSignal, DriftType } from '../p18-orchestrator';

const FIXED_NOW = new Date('2026-05-23T00:00:00.000Z');

function makeSignal(drift_type: DriftType, severity: DriftSignal['severity'] = 'warn'): DriftSignal {
  return {
    trigger: 'known-systems-change',
    drift_type,
    category: 'architecture',
    severity,
    message: `synthetic ${drift_type}`,
    evidence: {
      matched_systems: ['sys_a', 'sys_b'],
      recommended_action: 'do something',
      escalation_target: 'auto-bounded-cut2',
      target_fingerprint: 'deadbeef',
    },
    idempotency_key: `p18:${drift_type}:deadbeef:p18-cut1.v1.0:2026-05-23`,
    source_ref: 'synthetic',
    policy_version: 'p18-cut1.v1.0',
    detected_at: FIXED_NOW.toISOString(),
  };
}

describe('P18 Cut 2 — Whitelist', () => {
  it('hat exakt 3 Aktionen', () => {
    expect(P18_HEAL_WHITELIST).toEqual([
      'SUGGEST_KNOWN_SYSTEM_ENTRY',
      'EMIT_GOVERNANCE_AUDIT',
      'TRIGGER_QUALITY_GATE_RERUN',
    ]);
  });

  it('rejected unbekannte Aktionen', () => {
    expect(isP18HealActionAllowed('AUTO_FIX_SCHEMA')).toBe(false);
    expect(isP18HealActionAllowed('REWRITE_KNOWN_SYSTEMS')).toBe(false);
    expect(isP18HealActionAllowed('AUTO_HEAL_ALL')).toBe(false);
    expect(isP18HealActionAllowed('SUGGEST_KNOWN_SYSTEM_ENTRY')).toBe(true);
  });
});

describe('P18 Cut 2 — deriveAllowedHealActions', () => {
  it('liefert für orphan_node SUGGEST + AUDIT, nicht TRIGGER_QUALITY_GATE_RERUN', () => {
    const a = deriveAllowedHealActions(makeSignal('orphan_node', 'info'));
    expect(a).toContain('SUGGEST_KNOWN_SYSTEM_ENTRY');
    expect(a).toContain('EMIT_GOVERNANCE_AUDIT');
    expect(a).not.toContain('TRIGGER_QUALITY_GATE_RERUN');
  });

  it('liefert für cross_domain_unbridged AUDIT + RERUN, nicht SUGGEST', () => {
    const a = deriveAllowedHealActions(makeSignal('cross_domain_unbridged', 'warn'));
    expect(a).toContain('TRIGGER_QUALITY_GATE_RERUN');
    expect(a).toContain('EMIT_GOVERNANCE_AUDIT');
    expect(a).not.toContain('SUGGEST_KNOWN_SYSTEM_ENTRY');
  });

  it('liefert für ssot_conflict NUR AUDIT', () => {
    const a = deriveAllowedHealActions(makeSignal('ssot_conflict', 'block'));
    expect(a).toEqual(['EMIT_GOVERNANCE_AUDIT']);
  });

  it('isQualityGateRelevant deterministisch', () => {
    expect(isQualityGateRelevant('cross_domain_unbridged')).toBe(true);
    expect(isQualityGateRelevant('rule_violation')).toBe(true);
    expect(isQualityGateRelevant('orphan_node')).toBe(false);
    expect(isQualityGateRelevant('ssot_conflict')).toBe(false);
  });
});

describe('P18 Cut 2 — Known-System-Suggestion', () => {
  it('mutiert nichts und liefert deterministischen Markdown', () => {
    const s = makeSignal('orphan_node', 'info');
    const a = buildKnownSystemSuggestion(s);
    const b = buildKnownSystemSuggestion(s);
    expect(a).toEqual(b);
    expect(a.copyable_markdown).toMatch(/known-systems-Eintrag/);
    expect(a.copyable_markdown).toMatch(/sys_a__orphan_node/);
    expect(a.suggested_system_id).toBe('sys_a__orphan_node');
    expect(a.reuse_neighbors).toEqual(['sys_b']);
  });

  it('flagged required_bridge_targets nur bei cross_domain_unbridged', () => {
    expect(buildKnownSystemSuggestion(makeSignal('cross_domain_unbridged')).required_bridge_targets.length).toBe(2);
    expect(buildKnownSystemSuggestion(makeSignal('orphan_node')).required_bridge_targets.length).toBe(0);
  });
});

describe('P18 Cut 2 — validateP18HealRequest', () => {
  const drift = makeSignal('cross_domain_unbridged', 'warn');

  it('ok: erlaubte Aktion + Reason ≥ 8', () => {
    const v = validateP18HealRequest({
      idempotency_key: drift.idempotency_key,
      action: 'EMIT_GOVERNANCE_AUDIT',
      reason: 'manuell geprüft, audit ok',
      drift,
    });
    expect(v.ok).toBe(true);
  });

  it('reject: unbekannte Aktion', () => {
    const v = validateP18HealRequest({
      idempotency_key: drift.idempotency_key,
      action: 'AUTO_REWRITE',
      reason: 'lange genug',
      drift,
    });
    expect(v.ok).toBe(false);
  });

  it('reject: Action außerhalb allowed_actions für Drift', () => {
    const v = validateP18HealRequest({
      idempotency_key: drift.idempotency_key,
      // SUGGEST nicht erlaubt für cross_domain_unbridged
      action: 'SUGGEST_KNOWN_SYSTEM_ENTRY',
      reason: 'manuell geprüft',
      drift,
    });
    expect(v.ok).toBe(false);
  });

  it('reject: Reason < 8', () => {
    const v = validateP18HealRequest({
      idempotency_key: drift.idempotency_key,
      action: 'EMIT_GOVERNANCE_AUDIT',
      reason: 'short',
      drift,
    });
    expect(v.ok).toBe(false);
  });

  it('reject: idempotency_key mismatch', () => {
    const v = validateP18HealRequest({
      idempotency_key: 'p18:other:key',
      action: 'EMIT_GOVERNANCE_AUDIT',
      reason: 'lange genug',
      drift,
    });
    expect(v.ok).toBe(false);
  });
});

describe('P18 Cut 2 — Idempotency-Key-Formel (Cut-1-Wiederverwendung)', () => {
  it('Key folgt p18:{drift_type}:{fp}:{policy}:{bucket}', () => {
    const s = makeSignal('orphan_node');
    expect(s.idempotency_key).toBe('p18:orphan_node:deadbeef:p18-cut1.v1.0:2026-05-23');
  });

  it('gleicher Drift + Bucket = gleicher Key', () => {
    const a = makeSignal('orphan_node');
    const b = makeSignal('orphan_node');
    expect(a.idempotency_key).toBe(b.idempotency_key);
  });

  it('anderer Bucket => anderer Key', () => {
    const a = makeSignal('orphan_node');
    const b = { ...makeSignal('orphan_node') };
    b.idempotency_key = a.idempotency_key.replace('2026-05-23', '2026-05-24');
    expect(a.idempotency_key).not.toBe(b.idempotency_key);
  });
});

describe('P18 Cut 2 — Audit-Metadata enthält keine Raw-Payloads / Secrets', () => {
  it('liefert nur PII-arme, kontrakttreue Felder', () => {
    const meta = buildAuditMetadata(makeSignal('rule_violation'), 'EMIT_GOVERNANCE_AUDIT', 'pending');
    const keys = Object.keys(meta).sort();
    expect(keys).toEqual([
      'allowed_actions',
      'drift_type',
      'finding_count',
      'idempotency_key',
      'matched_system_ids',
      'policy_version',
      'requested_action',
      'result_status',
      'severity',
      'target_fingerprint',
      'trigger_source',
      'verdict',
    ]);
    // forbidden keys
    for (const forbidden of ['raw_proposal', 'secret', 'payload', 'body', 'token', 'access_key']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('P18 Cut 2/3 — Static Pureness Guards', () => {
  const dir = resolve(process.cwd(), 'src/lib/governance');
  const policySrc = readFileSync(resolve(dir, 'p18-heal-policy.ts'), 'utf8');
  const orchestratorSrc = readFileSync(resolve(dir, 'p18-orchestrator.ts'), 'utf8');
  const executorSrc = readFileSync(resolve(dir, 'p18-heal-executor.functions.ts'), 'utf8');

  it('p18-heal-policy.ts hat KEINEN Supabase-Import', () => {
    expect(policySrc).not.toMatch(/from\s+['"]@\/integrations\/supabase\/client['"]/);
    expect(policySrc).not.toMatch(/supabase\.rpc|supabase\.from/);
  });

  it('p18-orchestrator.ts bleibt pure (kein Supabase, kein INSERT)', () => {
    expect(orchestratorSrc).not.toMatch(/from\s+['"]@\/integrations\/supabase\/client['"]/);
    expect(orchestratorSrc).not.toMatch(/INSERT\s+INTO/i);
  });

  it('p18-heal-executor ruft AUSSCHLIESSLICH whitelisted RPCs', () => {
    const rpcCalls = [...executorSrc.matchAll(/supabase\.rpc\(\s*['"]([a-z0-9_]+)['"]/gi)].map((m) => m[1]);
    expect(rpcCalls.length).toBeGreaterThan(0);
    const allowed = new Set([
      'admin_p18_record_detection',
      'admin_p18_request_heal',
      'admin_p18_mark_healed',
      'admin_get_p18_ledger',
    ]);
    for (const c of rpcCalls) expect(allowed.has(c)).toBe(true);
  });

  it('p18-heal-executor schreibt NICHT direkt in known-systems.ts (kein fs/fs-promises Import, kein writeFile)', () => {
    expect(executorSrc).not.toMatch(/from\s+['"]node:fs/);
    expect(executorSrc).not.toMatch(/from\s+['"]fs['"]/);
    expect(executorSrc).not.toMatch(/writeFile|writeFileSync|appendFile/);
  });

  it('keine "heal_all" / "auto_fix_all" Symbole', () => {
    const all = `${policySrc}\n${executorSrc}`;
    expect(all).not.toMatch(/heal_all|auto_heal_all|auto_fix_all|bulk_heal/i);
  });
});
