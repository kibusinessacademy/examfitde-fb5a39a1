---
name: P20 Cut 0A Wiring Closure v1
description: P18 Auto-Trigger-Hook (architecture-review-done → admin_p18_record_detection) + AI Runtime Observability/Intervention Tabs live gemountet. Pure Cores unverändert.
type: feature
---

# P20 Cut 0A — Wiring Closure

Schließt drei lose Wiring-Lücken zwischen P18 Forensics/Heal und AI Runtime Center
**ohne neue Domänenlogik** und **ohne neue SSOT/Queue/Audit-Struktur**.

## A) P18 Auto-Trigger-Hook
- Neue Datei: `src/lib/governance/p18-review-hook.ts`
- Pure Review-Core (`architecture-review.ts`, `p18-orchestrator.ts`) bleibt **unverändert**.
- Adapter ruft nach erfolgreichem `reviewArchitecture(proposal)`:
  - `runP18Cut1({ architectureReviewDone: { review } })`
  - pro Signal: `recordP18Detection(sig)` (existierende RPC `admin_p18_record_detection`)
- **Trigger-Source** = `architecture-review-done` (in Cut-1-Whitelist).
- Idempotenz: bestehende Formel
  `p18:{drift_type}:{target_fingerprint}:{policy_version}:{time_bucket}` —
  wiederholte Reviews schreiben **keine Doppel-Rows**.
- Noise-Suppression: `verdict='approved' && findings.length === 0` → noop.
- Fehler werden gesammelt (nicht geworfen), Toast in der UI.
- Wired in `ArchitecturePage.tsx` (Hauptproposal-Review-Pfad). RuntimePreflight-Subform
  ruft den Hook bewusst noch nicht (kommt in Cut 0B falls nötig).

## B) AI Runtime Observability Tab (live)
- Neue Card: `src/features/admin/components/AiObservabilityCard.tsx`
- Quelle: `admin_get_ai_observability_summary` (existierende RPC).
- KPI-Strip + Detail-Tabelle (model × job_type × halluc/grounding/scope/drift/rollbacks/critical).
- Empty/Loading/Error mit Retry. **Read-only**, keine Mutationen.

## C) AI Runtime Intervention Tab (live)
- Neue Card: `src/features/admin/components/RecommendationPolicyEffectivenessCard.tsx`
- Neue **Wrapper-RPC** `admin_get_recommendation_policy_effectiveness()`:
  - SECURITY DEFINER + `has_role('admin')`-Gate
  - REVOKE FROM PUBLIC/anon; GRANT EXECUTE TO authenticated
  - liest existierende View `v_recommendation_policy_effectiveness`
  - keine neue Tabelle, keine Audit-Struktur
- UI: Filterbare Tabelle (recommendation_type / reason_code), Empty/Loading/Error.
- Banner: „Read-only policy effectiveness. Policy-Änderungen erfolgen nicht hier."

## Static-Guards
Bestehende Pureness-Tests in `p18-heal-policy.test.ts` decken Orchestrator-Pureness ab.
Neue `p18-review-hook.test.ts` ergänzt:
- `architecture-review.ts` enthält keinen Supabase-Import
- `p18-orchestrator.ts` enthält keinen Supabase-Import
- `p18-review-hook.ts` schreibt nur via `recordP18Detection` (kein direkter `supabase.rpc`)

## Tests
- `src/lib/governance/__tests__/p18-review-hook.test.ts` — 7 Tests:
  - approved+0 findings → no Mutation
  - blocked+findings → recorded
  - doppelter Aufruf → identische Idempotency-Keys
  - RPC-Fehler → gesammelt, blockiert nicht
  - 3× Pureness Contract
- Bestehende: 17 Orchestrator + 22 Heal-Policy = **46/46 grün**.

## Bewusst NICHT gebaut
- Keine Mutation-Buttons in Observability/Intervention Tabs
- Keine Auto-Optimize / Heal-All Aktionen
- Keine GIL-Mutation (P19 unverändert)
- Keine neue Tabelle / Queue / Audit-Stream
- Keine Policy-Mutation aus Intervention-Tab
- Kein Hook im RuntimePreflight-Subform (eigene Sub-Component, separater Cut wenn benötigt)
- Kein P18→GIL Bridge (das ist Cut 0B)

## Rollback
1. RPC `admin_get_recommendation_policy_effectiveness` droppen.
2. `p18-review-hook.ts` löschen, ArchitecturePage `runReview` zurück auf sync.
3. Beide neuen Cards aus `RuntimeCommandCenterPage` entfernen, Placeholder zurück.

## Querverweise
- `mem://architektur/governance/p18-cut1-semantic-drift-forensics-v1`
- `mem://architektur/governance/p18-cut2-cut3-bounded-heal-and-ledger-v1`
- `mem://architektur/ops/ai-runtime-command-center-v1`
- `mem://architektur/governance/architectural-continuity-guard-v1`
