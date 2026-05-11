---
name: Audit-only Hard-Block (Welle 5.3)
description: BEFORE-Trigger blockt jede Mutation auf audit_only Modulen, audit-Spur in run + auto_heal_log
type: feature
---

## Garantie
Module mit `generator_kind='audit_only'` (aktuell `cta`, `funnel_events`) können **strukturell** keine Content-Mutation persistieren. Jede Mutation-Spur im `artifact_ref` wird vor dem Schreiben hard-rolled-back.

## Mechanik
- Helper `fn_growth_artifact_has_mutation_signals(jsonb)` (IMMUTABLE) prüft Top-Level-Keys (`mutated`, `changes`, `created_assets`, `updated_records`, `inserted_rows`, `deleted_rows`, `wrote_records`, `content_mutation`) auf truthy Werte plus eine optionale verschachtelte `mutation`-Map.
- Trigger `trg_growth_audit_only_block_mutation` (BEFORE INSERT/UPDATE OF artifact_ref, status) auf `growth_repair_runs`:
  1. forciert `status = 'rolled_back'`
  2. ergänzt `rollback_info.reasons` um `audit_only_mutation_blocked` (idempotent)
  3. annotiert `artifact_ref.audit_only_mutation_block` (blocked_at, hits, reason)
  4. schreibt `auto_heal_log` mit `action_type='audit_only_mutation_blocked'`, `result_status='blocked'`, `target_id=run.id`, `metadata.hits`

## Smoke (Migration)
- Run mit `{ mutated:true, changes:[...] }` → `status=rolled_back` ∧ Reason gesetzt ∧ Block-Annotation vorhanden.
- Sauberes Audit-Artefakt → kein `audit_only_mutation_blocked`-Reason.

## Folge für Welle 5.3
- Cockpit-Card "Next Best Growth Fix" zeigt unverändert die Empfehlungen.
- Drilldown verlinkt auf `/admin/studio/:packageId`.
- Selbst wenn ein zukünftiger Worker für `cta`/`funnel_events` versehentlich Mutationsfelder schreibt, persistiert die DB sie nicht — der Run wird rolled_back und die Blockade ist im Audit-Log nachweisbar.
