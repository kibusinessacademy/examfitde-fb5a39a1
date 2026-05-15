---
name: Quality Gate Healer Fairness + Audit Truth v1
description: fn_auto_trigger_quality_gate_heal Eligible-First-Selektion + RETURNING/ROW_COUNT Audit-Wahrheit. Schließt Silent-Drop-Verdacht.
type: feature
---

## Root-Cause Audit (2026-05-15)

`fn_auto_trigger_quality_gate_heal` hatte zwei latente Defekte, die zusammen den Eindruck eines BEFORE-INSERT Silent-Drops erzeugten:

1. **Audit-Lüge**: Plain `INSERT INTO job_queue VALUES (...)` ohne `RETURNING id` / `GET DIAGNOSTICS ROW_COUNT`. Bei Trigger-RETURN-NULL wurde trotzdem `result_status='healed'` mit `enqueued_job_id=NULL` geschrieben — Healer log war nicht beweisfähig.
2. **Throughput-Bottleneck**: `ORDER BY minutes_since_report DESC LIMIT 20` BEVOR Eligibility geprüft wurde. Bei 51 Blockern + 24h-Limit (`recent_auto_heals_24h<3`) waren 19/20 Top-Slots disqualifiziert → effektiv 1 Heal/Lauf, Backlog-Pakete ab Rang ~21 wurden NIE erreicht (z.B. Fachlagerist seit 2026-05-11 ungeheilt trotz 5366 min Block).

Reproducer-Probe `quality_gate_auto_heal_reproducer_probe` (strict read-only, kein `INSERT…ROLLBACK` wegen Trigger-Side-Effects) bestätigte: kein Conflict-Partner, kein BEFORE-INSERT-Drop reproduzierbar — der "Silent-Drop" war reine Audit-Fiktion.

## Fix v1 (Single Migration)

**Audit-Wahrheit:**
```
INSERT … RETURNING id INTO v_new_id;
GET DIAGNOSTICS v_rc = ROW_COUNT;
IF v_rc=1 AND v_new_id IS NOT NULL THEN
  result_status='healed', enqueued_job_id=v_new_id, rowcount=v_rc
ELSE
  result_status='skipped_silent_drop', returned_id_null=true, hint='BEFORE-INSERT trigger likely returned NULL without audit mirror'
END IF;
```

**Eligible-First-Fairness:**
- Scan ALL `v_quality_gate_blocked_packages` ORDER BY `minutes_since_report DESC` (kein early LIMIT)
- Pro Paket: `fn_classify_quality_gate_block` → `eligible_for_auto_heal` prüfen
- Erste `v_select_cap=20` ELIGIBLE Pakete heilen (oldest unhealed first)
- Skip-Reasons getrennt zählen: `rate_limited` (recent_heals≥3) / `active_repair` (Repair-Jobs laufen) / `not_due` (<60min) / `other`

**Run-Summary Audit** (`action_type='quality_gate_auto_heal_run'`):
```
candidates_total, eligible_total, selected_total, select_cap,
healed, silent_drops, failed,
skipped_rate_limited, skipped_active_repair, skipped_not_due, skipped_other,
fairness='eligible_first_oldest_unhealed'
```

## Smoke 2026-05-15 10:08 UTC

Manueller Aufruf nach Migration:
```
candidates_total: 51
eligible_total:   30
selected_total:   20
healed:           20  (vorher: 1 effektiv)
silent_drops:     0   (über 20 echte Inserts — keine reale Trigger-Drop-Reproduktion)
skipped_rate_limited: 19
```
20/20 Heals mit echtem `enqueued_job_id`. Backlog wird in ~3 Cron-Läufen abgebaut statt Wochen.

## Akzeptanz

- Kein manueller Force-Publish, kein Guard-Bypass.
- Fachlagerist nicht künstlich bevorzugt — landet automatisch im nächsten Tick (Rang 21 von 30 eligible).
- Silent-Drop-Untersuchung **geschlossen**: alte Audit-Lüge behoben, kein aktueller BEFORE-INSERT-Drop reproduziert.

## Folge-Pattern (Single Choke-Point)

Jeder Producer-INSERT in `job_queue` aus `auto_heal_*` Funktionen muss diesem Pattern folgen:
`INSERT … RETURNING id` + `GET DIAGNOSTICS ROW_COUNT` + 3-Wege-Audit (`healed` / `skipped_silent_drop` / `failed`). Andernfalls bleibt Audit nicht beweisfähig bei zukünftigen Guard-Mirror-Lücken.

## Migration

`supabase/migrations/20260515*` (CREATE OR REPLACE FUNCTION fn_auto_trigger_quality_gate_heal).
Rollback: vorherige Source aus pg_get_functiondef-History oder migrations-Archiv.
