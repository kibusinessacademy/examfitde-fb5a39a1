---
name: Silent-Reject Diagnose & Struktur-Fix B (2026-04-18)
description: enqueue_job_if_absent gab gefälschte UUIDs bei Reject zurück. Hollow-Guard JOIN-Pfad korrigiert auf SSOT (competencies→learning_fields). ZERTIFIKAT-Track in applicability ergänzt.
type: feature
---

# Schritt B — Strukturfix nach Drip-Diagnose

## Root Cause des stillen Verwerfens
`enqueue_job_if_absent` Guard 2 (Zero-Progress) gab `gen_random_uuid()` als Fake-ID zurück, wenn ein Job geblockt wurde. Aufrufer (Drip, UI, Edge-Functions) interpretierten das fälschlich als "created:true". Tatsächlich landete **0 Rows in job_queue**.

## Die 3 B-Fixes

### B1 — enqueue_job_if_absent transparent
- Bei `fanout_capped` und `zero_progress_blocked` jetzt `id=NULL` (statt fake UUID)
- Status-Werte explizit: `duplicate_active`, `fanout_capped`, `zero_progress_blocked`, `pending`
- Jeder Reject schreibt `auto_heal_log` Eintrag mit Reason — auditierbar

### B2 — Track-Applicability für ZERTIFIKAT
`track_step_applicability` enthielt nur AUSBILDUNG_VOLL, EXAM_FIRST, EXAM_FIRST_PLUS, STUDIUM. Track `ZERTIFIKAT` (z.B. PRINCE2, Scrum Master) fehlte komplett. Jetzt ergänzt für alle 4 LC-Steps.

### B3 — Hollow-Guard SCHEMAFEST (v2, 2026-04-18 19:27)
**WICHTIG**: Die erste B3-Version war schemafalsch (nutzte `JOIN modules m ... JOIN curriculum c` — Tabelle `curriculum` existiert nicht, sie heißt `curricula`; und `lessons.module_id` ist nicht der SSOT-Pfad).

**Korrigierter SSOT-Pfad** (in `fn_trigger_sync_step_on_job_complete`):
```sql
FROM course_packages cp
JOIN learning_fields lf ON lf.curriculum_id = cp.curriculum_id
JOIN competencies co ON co.learning_field_id = lf.id
JOIN lessons l ON l.competency_id = co.id
WHERE cp.id = NEW.package_id;
```

**Auch entfernt**: `jsonb_typeof(l.content) = 'object'` Check (fragil bei text/jsonb-Mix). Stattdessen reine `length(l.content::text)` Heuristik.

**Schwellen**:
- `real_lessons`: content::text >= 1000 chars UND generation_status NOT IN (pending,placeholder,failed)
- `placeholder_lessons`: content NULL ODER < 200 chars ODER status IN (pending,placeholder)
- Hollow-Trigger wenn placeholders > 0 ODER ratio < 0.90
- Setzt Step zurück auf `queued` mit `meta.allow_regression_by='b3_hollow_guard_revoke'`

## Schemas die abweichen vom erwarteten Layout
- `track_step_applicability.condition` (nicht `reason`)
- Track-Kind = `product_track` (nicht `track_kind`)
- Tabelle heißt `curricula` (nicht `curriculum`)
- `package_lessons_realness` View existiert NICHT — immer inline aus SSOT-Pfad
- **SSOT-Pfad für Lesson-Aggregation**: lessons → competencies → learning_fields.curriculum_id → course_packages
- **NICHT verwenden**: lessons.module_id → modules → curriculum (schemafalsch)
