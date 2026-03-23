# Memory: architektur/pipeline/validation-loop-recovery-policy-v2-2
Updated: now

Um Sackgassen in der Pipeline ('Validation Loops' oder 'Double Guard Deadlocks') zu vermeiden, darf der Schritt `generate_learning_content` bereits bei einer inhaltlichen Abdeckung von ≥95 % den Status `done` einnehmen. Dies verhindert, dass geringfügige Verarbeitungsrückstände (`needs_regen > 0`) in Kombination mit aggressiven Fertigstellungs-Guards zu Endlos-Resets ('Queued-Spiralen') führen. Verbleibende Inhaltslücken werden als Qualitäts-Themen behandelt, die durch den finalen `run_integrity_check` vor der Veröffentlichung abgesichert werden.

## Systemischer Fix (v2.2 → v3.0)

Der Fix wurde auf drei Ebenen implementiert:

### 1. Cascade-Reset Härtung (DB-Trigger)
- `fn_is_real_step_regression()`: Prüft ob ein Statuswechsel eine echte Regression ist (nur `done → queued/enqueued/failed`)
- `trg_cascade_reset_downstream_steps`: Feuert nur noch bei echter Regression, nicht bei `queued → queued` oder `running → queued`
- Verhindert die "Cascade-Reset Spirale" die 22+ Pakete blockiert hatte

### 2. Material Completion Model (pipeline-process.ts)
- **Completion Guard**: `generate_learning_content` wird als `done` akzeptiert bei ≥95% Completion Ratio
- **shouldFinalize**: Berücksichtigt jetzt `completion_guard.completion_ratio` aus Step-Meta
- Bei material completion + `needs_regen > 0` → automatisches Enqueuen von `lesson_regen_repair` Jobs

### 3. Rework-Kanal (lesson-regen-repair Worker)
- Neuer Edge Function Worker `lesson-regen-repair`
- Konservative Phase-1-Logik: Content vorhanden → `needs_regen` Flag löschen; Content leer → explizit als Failed markieren
- Verhindert stilles Endlos-Queuing

### 4. Automatische Deadlock-Erkennung (stuck-scan)
- `healLearningContentDeadlocks()` in stuck-scan-hygiene.ts integriert
- Nutzt `ops_learning_content_deadlock_candidates` View zur Kandidatenerkennung
- Ruft `heal_learning_content_deadlock()` RPC alle 10 Minuten auf
- Loggt Heilungen in `auto_heal_log`

### 5. Resume-Heal RPCs
- `heal_learning_content_deadlock(package_id, threshold, enqueue_regen)`: Heilt einzelne oder alle Pakete
- `enqueue_learning_content_regen_for_package(package_id, limit)`: Enqueued gezielt Rework-Jobs mit curriculum_id
