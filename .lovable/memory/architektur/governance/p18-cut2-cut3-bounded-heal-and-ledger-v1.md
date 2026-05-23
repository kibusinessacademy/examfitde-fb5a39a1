---
name: P18 Cut 2 + Cut 3 — Bounded Heal Whitelist + Idempotency-Ledger
description: 3-Action-Whitelist (SUGGEST/AUDIT/RERUN) plus persistente p18_idempotency_ledger State-Machine. Pure-Layer bleibt unberührt; Mutation nur über 4 SECURITY DEFINER RPCs.
type: feature
---

# P18 Cut 2 + Cut 3 — Bounded Heal + Ledger

**Mentales Modell**: Detection → Classification → Evidence → **bounded Heal** → Ledger-State.
P18 bleibt **kein Self-Changing System**. Die einzigen erlaubten Mutationen sind 3 deterministisch ableitbare Aktionen, jede idempotent über `idempotency_key`.

## Cut 2 — Bounded Heal Whitelist (genau 3 Aktionen)

| Action | Mutiert? | Eligibility |
|---|---|---|
| `SUGGEST_KNOWN_SYSTEM_ENTRY` | nein (nur Markdown-Vorschlag) | `orphan_node`, `healability_missing`, `duplicate_registration`, `reuse_recommendation` |
| `EMIT_GOVERNANCE_AUDIT` | bounded (via `fn_emit_audit`) | universell |
| `TRIGGER_QUALITY_GATE_RERUN` | bounded (deterministic trigger) | `cross_domain_unbridged`, `rule_violation` |

**Hard No-Go (per Static Guard erzwungen):**
- kein Auto-Write in `known-systems.ts`
- kein `writeFile` / `node:fs` Import im Executor
- keine Schema-Migration aus P18
- keine Queue-/Content-/SEO-Rewrites
- kein "heal_all" / "auto_fix_all" / "bulk_heal"
- kein production write außerhalb der 3 Whitelist-Aktionen

**SSOT-Files:**
- `src/lib/governance/p18-heal-policy.ts` — pure (kein Supabase-Import; per Test verifiziert).
- `src/lib/governance/p18-heal-executor.functions.ts` — der **einzige** Server/RPC-Pfad. Ruft ausschließlich die 4 RPCs (per Test verifiziert).

## Cut 3 — Idempotency-Ledger

Tabelle `public.p18_idempotency_ledger`:
- `idempotency_key UNIQUE` (Pflichtformel `p18:{drift_type}:{target_fingerprint}:{policy_version}:{time_bucket}`)
- `status ∈ {detected,escalated,heal_requested,healed,rejected,suppressed}`
- `severity`, `verdict`, `allowed_actions[]`, `matched_system_ids[]`, `last_action`, `action_reason`
- **keine raw_payload jsonb-Spalte**, keine secret-bearing fields
- RLS enabled — admin SELECT-Policy; Writes ausschließlich über SECURITY DEFINER RPCs.

**RPCs:**
- `admin_p18_record_detection(p_drift jsonb)` — upsert by `idempotency_key`, idempotent. Initial-Status `escalated` bei `severity='block'`, sonst `detected`. Schreibt Audit `p18_semantic_drift_detected`.
- `admin_p18_request_heal(p_idempotency_key, p_action, p_reason)` — `reason ≥ 8`, Action muss in `allowed_actions` enthalten sein, blockiert Aktionen außerhalb der 3-Whitelist. Setzt Status `heal_requested`. Audit `p18_bounded_heal_requested`.
- `admin_p18_mark_healed(p_idempotency_key, p_action, p_result_status)` — `healed|rejected`, nur aus `heal_requested`. Audit `p18_bounded_heal_completed|_rejected`.
- `admin_get_p18_ledger(p_limit, p_status, p_drift_type)` — read-only, admin-gated, ohne Raw-Payloads.

**Audit-SSOT bleibt** `fn_emit_audit` + `ops_audit_contract`. Vier Contracts registriert (`p18_semantic_drift_detected`, `..._requested`, `..._completed`, `..._rejected`) mit PII-armen `required_keys`.

## 6-Glied-Kette

```
trigger → detection → classification → evidence → escalation → bounded_action
```

Fehlt ein Glied → Aktion verboten. Static Guard im Test verifiziert Pureness.

## UI

`/admin/governance` Tab **„P18 Bounded Heal"** (Komponente `P18BoundedHealPanel.tsx`):
- pro Drift-Signal: deterministisch erlaubte Aktionen, Ledger-Status-Badge.
- Reason-Pflicht ≥ 8 Zeichen.
- Known-System-Suggestion ist **kopierbar** (Markdown), nicht schreibend.
- Ledger-History: Status-/Drift-Filter, read-only.
- **kein** „Auto Heal All", **kein** Direkteditieren von Ledger-Zeilen.

## Tests

- `src/lib/governance/__tests__/p18-heal-policy.test.ts` — 22/22 grün.
  - 3-Action-Whitelist (positive + negative).
  - Eligibility deterministisch pro `drift_type`.
  - Audit-Metadata enthält genau 12 PII-arme Keys, keine `payload/secret/raw_proposal/token/access_key`.
  - Idempotency-Key folgt exakter Formel; gleicher Drift+Bucket = gleicher Key.
  - **Static Pureness Guards** (read-from-disk):
    - `p18-heal-policy.ts` ohne Supabase-Import.
    - `p18-orchestrator.ts` ohne Supabase, kein `INSERT INTO`.
    - Executor ruft NUR die 4 RPCs (Whitelist).
    - Executor ohne `node:fs` / `writeFile`.
    - Keine `heal_all|auto_heal_all|auto_fix_all|bulk_heal` Symbole im Modul.
- Cut-1-Regression: 17/17 grün → unverändert.

**Architecture Continuity Guard:** Proposal `docs/examples/architecture-proposals/p18-bounded-heal-ledger-approved.json` — verdict `approved` (HEALABILITY_IS_REQUIRED, NO_PARALLEL_SYSTEMS, AUDITABLE_MUTATIONS, NO_AUTONOMOUS_PRODUCTION_WRITES erfüllt; keine zweite Audit-/Queue-/Content-/Governance-Struktur erzeugt).
