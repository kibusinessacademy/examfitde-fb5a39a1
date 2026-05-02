---
name: Cancel-Storm Hard-Guard v2
description: Identity-Tagging aller Reverter-Funktionen + Rate-Limit-Trigger. Schließt v1 Lücke (auto_heal_building_zombies war Hauptquelle der unknown_trigger-Reverts).
type: feature
---

# Cancel-Storm Hard-Guard v2 (2026-05-02)

## Forensik
- 468 PATTERN_X6_STATUS_REVERTER detections in 6h, davon nur 60 vom v1-Hard-Guard geblockt.
- Top-3 Pakete (570ccb3e, 335decc8, b960658d) = 339 Reverts mit approved_q ≥ 1956. b960658d landete trotz 1956 approved Q in `queued`.
- Reverter-Quelle identifiziert: **`auto_heal_building_zombies`** (cron) demoted alle building-Pakete ohne Lease/Jobs nach 30min, ohne Approved-Q-/Progress-Check und ohne `app.transition_source` zu setzen → Audit-Log = "unknown_trigger".

## Fixes
1. **`fn_package_demote_protected` v2**: `build_progress >= 100` ist immer geschützt (Edge-Case-Hardening).
2. **`auto_heal_building_zombies`**: setzt `app.transition_source='auto_heal_building_zombies'` + filtert via `fn_package_demote_protected`. Übersprungene Zombies werden als `auto_heal_zombie_skipped_protected` auditiert.
3. **`enforce_priority_gate`**: Identity-Tag + Schutz-Check vor Demotion.
4. **`fn_guard_revert_rate_limit`** (Trigger `trg_guard_revert_rate_limit` BEFORE UPDATE): blockt > 3 building→queued Reverts pro Paket / 6h. Bypass: `app.transition_source IN (admin_*)` oder `session_replication_role='replica'`. Audit `guard_block_revert_rate_limit`. Stützt sich auf das vorhandene PATTERN_X6_STATUS_REVERTER Audit als canonical revert log.

## Verboten
- Funktionen, die `course_packages.status` von `building` auf `queued` setzen, dürfen das nicht ohne `set_config('app.transition_source', '<eindeutiger_name>', true)` tun. Sonst → unknown_trigger.
- Demotion ohne `fn_package_demote_protected`-Check ist verboten in jeder neuen Healer-Funktion.

## Migration
- `20260502_2018_*.sql` (v2-Hardening + Rate-Limit)
- Persona-Drift Side-Fix: `ALTER TYPE product_persona RENAME VALUE 'umschulung' TO 'institution'` — DB ↔ Frontend-Whitelist konsistent. 49 Overlay-Rows pro Persona unverändert.
