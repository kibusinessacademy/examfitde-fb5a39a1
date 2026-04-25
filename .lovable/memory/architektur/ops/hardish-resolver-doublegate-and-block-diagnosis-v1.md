---
name: Hardish Resolver Double-Gate + Block-Diagnose v1
description: Resolver enqueued Hardish-Repair nur bei (toggle=true AND handler_registered=true), Block-Diagnose-RPC erkennt COVERAGE_GAP/PREREQ/GATE_FAIL/QUALITY/HTTP_500 für UI
type: feature
---

## Problem
- Toggle `heal_strategy_hardish_balance=true` hätte einen Pfad freischalten können, der operativ ins Leere läuft (Pending-Jobs ohne Verarbeitung), wenn Edge-Handler nicht produktiv ist.
- Reines Resolver-Verhalten reichte nicht: Runner/Dispatcher braucht zusätzlichen Beweis, dass Handler registriert ist.
- Operativ blockierende Pakete zeigten in der UI nur generische `last_error`-Strings, keine Klassifikation.

## Lösung
1. **Doppelter Gate im Resolver**: `admin_resolve_repair_strategy_for_package` enqueued `package_repair_hardish_balance` nur, wenn
   - `admin_settings.heal_strategy_hardish_balance.enabled = true` UND
   - `admin_settings.heal_strategy_hardish_balance.handler_registered = true`.
   Sonst Fallback `manual_review_required` mit klarer Begründung (`handler_not_registered` / `toggle_disabled`).
2. **Hardish-pct-Extraktion** aus `integrity_check_history.hard_fail_reasons` Array per Regex (`hardish_too_low_([0-9.]+)_pct`). `integrity_check_history` hat keine `metadata`-Spalte.
3. **Default-Setting** auf `enabled=false`, `reason=handler_not_proven_in_production`, `handler_registered=true` (Edge-Function ist deployed).
4. **Audit-Log**: Jede Resolver-Entscheidung loggt in `admin_notifications` (Kategorie `heal_strategy_resolver`).
5. **Block-Diagnose-RPC** `admin_get_package_block_diagnosis(uuid)` liefert pro offenem Step die Klassifikation:
   - `COVERAGE_GAP` (auch bei Präfix `auto-publish crash:`)
   - `PREREQ` / `CAUSALITY` / `GATE_FAIL` / `QUALITY` / `HTTP_500` / `WAITING_DEPENDENCY` / `OTHER`
6. **UI-Panel** `PackageBlockDiagnosisPanel` im PackageDrawer zeigt diese Klassifikation badge-basiert mit Icon und Auto-Refresh (15s).

## Verifizierte Fälle aus Live-Queue
| Job | block_type | Detail |
|---|---|---|
| `package_auto_publish` (Kfm. E-Commerce) | COVERAGE_GAP | `competency_question_coverage_pct=72.2 < track-min=80.0` |
| `package_validate_lesson_minichecks` (BWL-Steuern) | GATE_FAIL | `NO_MINICHECKS` |
| `package_run_integrity_check` (Bankfachwirt) | QUALITY | `integrity_score=91 < gate=COURSE_READY_v1.7` |
| `package_generate_blueprint_variants` (FiSi-DigVer) | PREREQ | `validate_blueprint_variants not done` |

Diese sind **keine Bugs** sondern korrekte Causality-/Quality-Gates — die Diagnose macht das jetzt sofort sichtbar.
