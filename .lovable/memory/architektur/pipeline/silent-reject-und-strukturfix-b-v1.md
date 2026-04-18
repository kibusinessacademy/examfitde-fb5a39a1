---
name: Silent-Reject Diagnose & Struktur-Fix B (2026-04-18)
description: enqueue_job_if_absent gab gefälschte UUIDs bei Reject zurück. Hollow-Guard nutzte fehlende View. ZERTIFIKAT-Track fehlte in applicability. Komplett behoben.
type: feature
---

# Schritt B — Strukturfix nach Drip-Diagnose

## Root Cause des stillen Verwerfens
`enqueue_job_if_absent` Guard 2 (Zero-Progress) gab `gen_random_uuid()` als Fake-ID zurück, wenn ein Job geblockt wurde. Aufrufer (Drip, UI, Edge-Functions) interpretierten das fälschlich als "created:true". Tatsächlich landete **0 Rows in job_queue**.

## Die 3 B-Fixes

### B1 — enqueue_job_if_absent transparent
- Bei `fanout_capped` und `zero_progress_blocked` jetzt `id=NULL` (statt fake UUID)
- Status-Werte sind explizit: `duplicate_active`, `fanout_capped`, `zero_progress_blocked`, `pending`
- Jeder Reject schreibt `auto_heal_log` Eintrag mit Reason — auditierbar

### B2 — Track-Applicability für ZERTIFIKAT
`track_step_applicability` enthielt nur AUSBILDUNG_VOLL, EXAM_FIRST, EXAM_FIRST_PLUS, STUDIUM. Track `ZERTIFIKAT` (z.B. PRINCE2, Scrum Master) fehlte komplett. Jetzt ergänzt für alle 4 LC-Steps.

### B3 — Hollow-Guard ohne realness view
Säule 2 (vom 18.04. Mittag) referenzierte `package_lessons_realness` — Tabelle existiert nicht. Trigger lief leer. Jetzt **inline berechnet** aus `lessons` Tabelle:
- `real_lessons`: content >= 800 Zeichen UND generation_status NOT IN (pending,placeholder,failed)
- `placeholder_lessons`: content < 200 Zeichen ODER status IN (pending,placeholder)
- Hollow-Trigger wenn placeholders > 0 ODER ratio < 0.90
- Setzt Step zurück auf `queued` mit `meta.allow_regression_by='b3_hollow_guard_revoke'`

## Schemas die abweichen vom erwarteten Layout
- `track_step_applicability.condition` (nicht `reason`)
- Track-Kind = `product_track` (nicht `track_kind`)
- `package_lessons_realness` View existiert NICHT — immer inline aus `lessons` joinen
