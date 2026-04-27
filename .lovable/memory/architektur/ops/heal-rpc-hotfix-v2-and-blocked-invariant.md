---
name: Heal RPC Hotfix v2 — Schema-Drift + Blocked-Invariante
description: Fix step_key (RETURNING via FROM-CTE) in admin_quarantine_hotloop_jobs, performed_by→user_id in admin_reap_stale_processing_now, plus BEFORE-Trigger fn_assert_blocked_status_reason_consistency hält status='blocked' und blocked_reason gekoppelt; AFTER-Trigger loggt jedes Re-Block nach Heal.
type: feature
---

# Heal RPC Hotfix v2 (2026-04-27)

## Bugs behoben

1. **`admin_quarantine_hotloop_jobs` Execute → 42703 column "step_key"**
   - Ursache: `UPDATE … FROM cand … RETURNING jq.id, jq.package_id, c.step_key` — Postgres erlaubt in `RETURNING` keine Spalten aus FROM-Clause CTEs.
   - Fix: CTE auf nur `id` reduzieren; step_key separat aus `meta->>'step_key'` lesen.

2. **`admin_reap_stale_processing_now` → 42703 column "performed_by"**
   - Ursache: `INSERT INTO admin_actions(action, payload, performed_by)` — Spalte heißt `user_id`.
   - Fix: `performed_by` → `user_id` in INSERT.

## Neue Invariante (Schutz vor Re-Block-Drift)

`fn_assert_blocked_status_reason_consistency` (BEFORE INSERT/UPDATE auf course_packages):
- Wenn `NEW.status <> 'blocked'` aber `NEW.blocked_reason IS NOT NULL` → Reason+blocked_at+blocked_by werden auto-gecleart.
- Idempotent: Heal-Aktionen können `status='queued'` setzen ohne separat `blocked_reason` löschen zu müssen.
- Komplementär zu `trg_guard_blocked_requires_reason` (das die Gegen­richtung erzwingt: `blocked` ⇒ Reason gesetzt).

`fn_audit_reblock_after_heal` (AFTER UPDATE):
- Loggt in `auto_heal_log` jeden Status­übergang `(* → blocked)` mit `transition_source` Tag, damit man sieht, welcher Trigger/RPC re-blocked hat.

## UI

`TargetedHealCard` ergänzt um Action 3 — **Blocked-Packages Bulk-Heal nach Reason-Klasse**:
- Liest `v_admin_blocked_packages_diagnosis` (refetch 30s)
- Pro Klasse: Dry-Run → Execute via `admin_unblock_packages_by_reason(reason_class, max_packages=25, dry_run)`
- Execute disabled bis Dry-Run lief

## Tests

`src/components/admin/heal/cards/TargetedHealRpcs.test.ts` — 7 Smoke-Tests:
- Beide RPCs Dry-Run + Execute → kein `42703`
- `admin_unblock_packages_by_reason` für alle 7 valide Reason-Klassen → kein `42703`
- Pure-Logic Spec für die Status/Reason-Invariante (3 Cases)

## Anti-Pattern

- ❌ `RETURNING <fk_col>` aus FROM-CTE in UPDATE-Statements — PG-restriction
- ❌ Inserts in `admin_actions` mit angenommenen Spaltennamen — immer Schema prüfen
- ❌ `blocked_reason` clearen ohne `status` zu wechseln — Trigger erzwingt Konsistenz
