# Poison-Loop Guard (F-5)

## Umgesetzt: 2026-04-10

### Problem
Generator-Jobs (z.B. `package_generate_handbook`) können in deterministische Endlosschleifen geraten, wenn der Materializer denselben Job immer wieder einreiht, obwohl der Fehler identisch bleibt (z.B. `THRESHOLD_FAIL:handbook:sections:5/8`). Die bestehenden Guards (validation-requeue-guard, production-guardian POISONED_LOOP) greifen nicht bei Generators oder erst asynchron.

### Lösung
Synchroner Guard in `enqueue.ts` (F-5), der **vor dem Insert** prüft:

1. Job-Type ist ein Generator (`GENERATOR_GUARDED_JOB_TYPES`)
2. Es existieren ≥3 failed Jobs mit identischer Failure-Signatur für dasselbe Package innerhalb von 60 Minuten
3. → **Requeue wird blockiert**, kein neuer Job entsteht

### Maßnahmen bei Erkennung
- `package_steps.meta` wird mit `poison_loop_blocked: true` + `manual_review_required: true` gemerkt
- Audit-Log in `auto_heal_log` (action_type: `poison_loop_guard_block`)
- Kritische Admin-Notification

### Betroffene Job-Types
`package_generate_handbook`, `package_generate_exam_pool`, `package_generate_learning_content`, `package_generate_oral_exam`, `package_generate_lesson_minichecks`, `package_generate_glossary`, `package_generate_blueprint_variants`, `package_auto_seed_exam_blueprints`, `package_build_ai_tutor_index`, `package_elite_harden`

### Architektur
- **Datei**: `supabase/functions/_shared/poison-loop-guard.ts`
- **Integration**: `enqueue.ts` Zeile ~184 (nach validation-requeue-guard)
- **Fail-open**: Bei Guard-Fehler wird der Job trotzdem eingereiht (never break enqueue)
- **Komplementär zu**: validation-requeue-guard (Validators), production-guardian G4b (async 3-Strike), stuck-scan stale-lock-loop

### Invarianten
- Guard ist synchron beim Enqueue → kein Window für weitere Loop-Iterationen
- Failure-Signatur-Extraktion normalisiert Admin-Cleanup-Suffixe weg
- Step-Blocking ist additiv (merge, kein overwrite)
