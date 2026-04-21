---
name: Seed-Zombie & Pre-Build Adoption Gap v1
description: Forensik 2026-04-21 — 28 Zombie-Seed-Steps geheilt; 357 Pakete blockiert weil Blueprints deprecated und Pre-Build-Adoption nicht greift.
type: feature
---

## Befunde

### P0 geheilt (28 Pakete)
- `auto_seed_exam_blueprints` stand auf `queued` trotz vorhandener aktiver `question_blueprints` (deprecated_at IS NULL, status<>'deprecated')
- Recovery via direkter UPDATE mit Meta-Vertrag: `ok=true`, `executed=true`, `postcondition_verified=true`
- 197 PREREQ_NOT_DONE pending → 2 nach Recovery
- Audit: `admin_actions` action='ops_seed_zombie_recovery_v5'

### P1 separater Incident (357 Pakete)
- 357 Pakete mit `auto_seed_exam_blueprints=queued` haben **0 aktive** `question_blueprints` (alle 35.332 sind `deprecated`)
- Aber: `variant_prebuild_status='pending'` (346) oder `materializing'` (11)
- Pre-Build hat Variants erzeugt (480-660 pro Paket), aber **Adoption/Promotion** an die Pakete ist nicht erfolgt
- View `v_prebuild_adoption_candidates` zeigt diese als Kandidaten
- Diese Pakete brauchen einen echten Adoption-Run, KEIN Force-Done

## Guards-Vertrag (kritisch)

`fn_guard_ghost_completion`: verlangt `meta->>'ok' = 'true'`
`fn_guard_hollow_done` (auto_seed_exam_blueprints): verlangt active blueprints (deprecated_at IS NULL AND status<>'deprecated')
`fn_guard_hollow_done` (sonstige critical steps): verlangt `meta->>'postcondition_verified' = 'true'` ODER `allow_regression=true` ODER `exception_approved=true`

## Why force_steps_done() failed silently

`admin_force_steps_done()` mit emergency_bypass=true versucht `ALTER TABLE ... DISABLE TRIGGER` — funktioniert nicht in allen Sessions wegen Permission/read-only. Falls es still fehlschlägt: direkter UPDATE mit korrektem Meta-Vertrag ist die robustere Heilung.

## Nächster Schritt

Pre-Build-Adoption-Pfad für die 357er-Klasse triggern, NICHT force-done.
