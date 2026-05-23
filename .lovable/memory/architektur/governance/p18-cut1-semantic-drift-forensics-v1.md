---
name: P18 Cut 1 Semantic Drift Forensics
description: Pure read-only Detection/Classification/Evidence-Layer mit minimaler Trigger-Matrix (known-systems-change + architecture-review-done). Aufbau eines semantischen Drift-Korpus, kein Self-Healing.
type: feature
---

# P18 Cut 1 — Semantic Drift Forensics (read-only)

**Mentales Modell**: semantische Architekturforensik, **NICHT** Self-Healing.
**Wert**: Aufbau eines deterministischen Drift-Korpus, der spätere Cuts (P19, Predictive Drift, AI Review Grounding) datengrundiert ermöglicht.

## SSOT-Modul

`src/lib/governance/p18-orchestrator.ts` — Pure TS, keine Supabase-/DB-Imports, keine Audit-Writes.

## Trigger-Matrix (bewusst minimal)

| Trigger | Status | Begründung |
|---|---|---|
| `known-systems-change` | **aktiv (Cut 1)** | Höchste semantische Klarheit, idealer Drift-Indikator |
| `architecture-review-done` | **aktiv (Cut 1)** | Bereits klassifizierte Architekturabsicht, sauberer Feed |
| `static-guard-failed` | reserviert (Cut 2) | erst nach stabilem Drift-Korpus |
| `runtime-anomaly-detected` | reserviert (Cut 3) | zu noisy/probabilistisch — Risiko Infrastruktur-Monitoring statt Architektur-Monitoring |
| `memory-sync-drift` | reserviert (später) | |
| `semantic-runtime-conflict` | reserviert (später) | |

`P18_ACTIVE_TRIGGERS` ist die SSOT-Whitelist; `isTriggerActive()` ist der Gate-Helper.

## Drift-Klassifikation

| drift_type | severity | category | escalation_target |
|---|---|---|---|
| `ssot_conflict` | block | architecture | human-architect |
| `healability_missing` | block | architecture | human-architect |
| `duplicate_registration` | block | governance | human-architect |
| `cross_domain_unbridged` | warn | architecture | auto-bounded-cut2 |
| `rule_violation` | warn | governance | auto-bounded-cut2 |
| `orphan_node` | info | architecture | observe-only |
| `reuse_recommendation` | info | architecture | observe-only |

## Detection-Heuristiken (Cut 1)

**Trigger 1 — `detectFromKnownSystemsChange`** (gegen `KNOWN_SYSTEMS`):
- duplicate Registry-Namen → `duplicate_registration`
- Mutationspfad (kind ≠ view/registry) ohne volle Healability → `healability_missing`
- keine neighbors + keine event_contracts + keine audit_actions → `orphan_node`
- Cross-Domain-Kante ohne event_contracts auf einer Seite → `cross_domain_unbridged`

**Trigger 2 — `detectFromArchitectureReview`** (gegen `ArchitectureReview`):
- `NO_PARALLEL_SYSTEMS` → `ssot_conflict`
- `HEALABILITY_IS_REQUIRED` → `healability_missing`
- `EVENT_DRIVEN_BY_DEFAULT` → `cross_domain_unbridged`
- alle anderen Findings → `rule_violation`
- reuse_candidates → `reuse_recommendation` (info)

## Idempotency-Key (computed, NICHT persistiert)

```
p18:{drift_type}:{target_fingerprint}:{policy_version}:{time_bucket}
```

- `target_fingerprint` = FNV-1a 32-bit Hash des Targets (deterministisch, ohne Crypto-Dep)
- `policy_version` = `p18-cut1.v1.0`
- `time_bucket` = `YYYY-MM-DD` (täglich)
- **Ledger ist Cut 3** — Cut 1 verwendet den Key nur zur In-Memory-Dedupe.

## Hard-Limits

- Kein DB-Write. Kein `fn_emit_audit`-Call. Kein `INSERT`.
- Modul hat keine Supabase-Imports (Test erzwingt das).
- Trigger Cut 2/3 deaktiviert — Signalrauschen-Schutz.
- Output ist deterministisch (gleicher Input → gleiches JSON).

## UI

`/admin/governance` Tab **„P18 Forensics"** — read-only Drift-Korpus + JSON-Export. Keine Action-Buttons.

## Tests

`src/lib/governance/__tests__/p18-orchestrator.test.ts` — 17/17 grün:
- Trigger-Topologie (nur 2 aktiv)
- fingerprint deterministisch
- jede Heuristik (dup, healability, orphan, cross-domain, view/registry exempt)
- Review-Mapping pro Rule
- Aggregator deterministisch + dedupliziert via Idempotency-Key
- Pureness-Contract (keine Supabase-Imports, kein INSERT)

## Anschluss

- **Cut 2**: bounded Heal Whitelist (3 Aktionen) — frühestens nach stabilem Drift-Korpus.
- **Cut 3**: Idempotency-Ledger — erst nachdem reale Drift-Fingerprints+Time-Buckets bekannt sind.
- **Cut 4+**: weitere Trigger-Quellen (`static-guard-failed` → `runtime-anomaly-detected`).
