---
name: synthetic-cohort-runner-v1
description: Interner Demo-Lerner-Validator. 7 Personas × N published Pakete. Heuristik + LLM-Gate. Read-only auf produktive Mastery.
type: feature
---

# Synthetic Cohort Runner v1

Validiert published Pakete didaktisch ohne echte Learner-Daten zu schreiben.

## Architektur
- **7 Personas** in `synth_personas` (struggler, average, top, speed_runner, quitter, repeater, perfectionist) mit Verhaltens-Profil (target_accuracy, response_speed_factor, completion_rate, retry_rate, hint_usage_rate).
- **Run-Header** `synth_cohort_runs`: Modus (heuristic_only | heuristic_with_llm_gate | llm_full), Pakete, Personas, Counter.
- **Session-Results** `synth_session_results`: pro Persona × Paket die simulierten Scores. **Read-only** — kein Write auf user_competency_progress / shuttle_*.
- **Findings** `synth_didactic_findings`: missing_step, low_ihk_coverage, no_learning_objectives, short_content, duplicate_lesson, thin_question_pool, llm_didactic_review (severity info|warn|critical).
- **Calibration** `synth_mastery_calibration`: nur Tuning-VORSCHLÄGE für Shuttle-Gewichte, kein Live-Apply.

## Heuristik-Regeln (synth_run_heuristic)
1. Required steps pro Kompetenz: einstieg, verstehen, anwenden, wiederholen, mini_check
2. IHK-Keyword-Coverage in Praxis-Steps (anwenden/wiederholen/mini_check) — min. 2 Begriffe
3. learning_objectives auf Einstieg-Lessons Pflicht
4. Min. 200 Zeichen content in verstehen/anwenden
5. Keine Lesson-Titel-Duplikate
6. ≥50 approved Fragen (≥150 empfohlen)

## LLM-Gate
Pakete mit didactic_score<70 OR step<70 OR ihk<60 OR question<60 OR critical-Finding werden für LLM-Review geflaggt.
Edge Function `synthetic-cohort-runner` ruft `gemini-2.5-flash` via Lovable AI Gateway mit Tool-Call (submit_review) für 3 Sample-Lessons. Cap: 10 LLM-Calls/Run (konfigurierbar via max_llm_calls).

## RPCs (admin-only via has_role)
- synth_seed_personas() — idempotent re-seed
- synth_start_run(package_ids, persona_keys, mode) → run_id
- synth_run_heuristic(run_id, package_id) → {scores, findings_count, flagged}
- synth_finalize_run(run_id) → {avg_didactic_score}
- synth_get_run_summary(run_id) → {run, packages[], top_findings[]}
- synth_list_runs(limit) → [runs]

## UI
`/admin/synthetic-cohort` — Personas-Card, Run-Historie (5s polling), Detail mit Paket-Ranking + Top-50-Findings.

## Mastery-Mode
Aktuell: Read-only. Calibration-Vorschläge werden NICHT live angewendet. Manuelle Review erforderlich bevor Shuttle-Gewichte angepasst werden.
