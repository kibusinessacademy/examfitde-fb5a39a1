---
name: Learning Progression Regression Guard v1
description: SQL smoke test (5 cases A–E) sichert, dass check_lesson_progression Badge-SSOT (learning_progress.completed) und Mastery-SSOT (lesson_outcomes.status='mastered') gleichwertig als Unlock-Signal akzeptiert; not_mastered bleibt blockierend; Reason-Texte „Mini-Check"/"Lernschritt" geprüft.
type: feature
---
SSOT-Vertrag check_lesson_progression (siehe Migration 20260523122057):
- allowed=true wenn lesson_outcomes.status='mastered' ODER learning_progress.completed=true
- allowed=false (reason='…Mini-Check…') wenn lesson_outcomes.status='not_mastered'
- allowed=false (reason='…Lernschritt…') wenn keinerlei Signal vorliegt

Smoke: supabase/tests/learning_progression_regression_v1_smoke.sql — BEGIN/ROLLBACK, 4 prev/next-Paare in einem Ephemer-Modul, 5 Cases (A learning_progress only, B lesson_outcomes mastered only, C not_mastered blocked, D no signals blocked, E reload-stable). 5/5 grün am 2026-05-23.

Bewusst NICHT eingeführt: parent_lesson_id-Refactor, generelle Entsperrung, Frontend-Shadow-State.
