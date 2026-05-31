---
name: ExamFit Oral Activation v2 — Realismus & Entry-Point (2026-05-31)
description: Per-Kurs CTA + Auto-Start aus Curriculum + Dual-Examiner/Stress-Sichtbarkeit + garantierte Rückfrage. Aufsetzend auf Oral Voice Activation v1 (browser-native). KEIN Neubau, keine neuen Tabellen.
type: feature
---

# Oral Activation v2 (2026-05-31)

## Scope (umgesetzt)
1. **Per-Kurs CTA** — LearnerDashboard "Mündlich" reicht `?curriculum=<id>` durch (vorher dead-link für Default-Curriculum). `needsCurriculum` lenkt ohne aktives Curriculum auf `/berufe` (gleicher Pattern wie Shuttle/Daily).
2. **Session-Start aus Curriculum** — `OralExamTrainer` startet automatisch sobald `?curriculum=` gesetzt + Access entitled + Phase=setup. Kein generischer Trainer-Einstieg mehr.
3. **Persona-Surface** — Header zeigt `Prüferstil: sachlich|kritisch|Stress` (abgeleitet aus `oral_exam_session_templates.stress_level`) + `Einzelprüfer` vs. `Prüfer A & B (Dual)` (aus `examiner_mode`). Defaults greifen wenn kein Template existiert.
4. **Garantierte Rückfrage** — Evaluation rendert IMMER eine Nachfrage. Wenn die Engine `follow_up_question` leer liefert, zeigen wir kontextbasierte Fallback-Nachfrage (Stress-Variante bei stress_level≥2). Header bei Dual-Mode beschriftet sie als "Prüfer B".

## SSOT-Treue
- Keine neuen Oral-Tabellen, keine zweite Engine.
- Persona/Realismus liest aus bestehenden `oral_exam_session_templates` (RLS unverändert).
- Auto-Start respektiert `useProductAccessByCurriculum('oral_trainer')` Gate.
- Browser-native Voice Stack aus v1 bleibt unverändert (Web Speech API + speechSynthesis, kein ElevenLabs).

## Bewusst NICHT in v2
- **Edge-Function-Erweiterung** (followup_chains/dual_examiner_roles in oral-exam Prompt): aufgeschoben — Templates in DB sind aktuell zu 100% Defaults (`examiner_mode='single'`, `stress_level=1`). Hebel erst wenn Templates angereichert sind. UI ist bereits dual-fähig.
- **Blueprint-Drift-Heal**: aktuell 16362/16362 Blueprints `status='approved'`. Kein Drift → keine Heal-RPC nötig. Bei Drift-Verdacht: `select status, count(*) from oral_exam_blueprints group by 1`.
- **CourseDetail-CTA**: AppOverviewPage zeigt kein Pro-Kurs-Detail — LearnerDashboard ist primärer Entry. Wenn später per-Kurs-Detail-Seite kommt, identischen `?curriculum=`-Pattern nutzen.

## Reality-Smoke (existierend, validiert v2-Pfad)
- `tests/e2e/oral-exam.spec.ts` + `tests/customer-reality/learner/09-oral-exam.spec.ts` deckt: Route → Start → Answer → Feedback. Persistence-Test in `tests/e2e/learner-oral-persistence.spec.ts`.
- v2-Auto-Start: Wenn `/oral-exam?curriculum=<id>` aufgerufen und Access vorhanden, springt UI ohne "Curriculum wählen"-Schritt in `phase=question`.

## Anti-Drift
- Nicht wieder Voice ausbauen (kein TTS-Provider, keine `MediaRecorder`-Push-to-Talk).
- Persona-Wirkung **immer** über Engine/Templates — nie über Stimm-Variation.
- Auto-Start nur bei vorhandenem Entitlement — nie als Bypass.
