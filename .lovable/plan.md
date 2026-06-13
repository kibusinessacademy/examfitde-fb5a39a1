# Sprint 1 — P0-3 Learner DB Binding

Ziel: Die vier Learner-Leitstellen erfüllen QFAF (Frage, Orientierung, Interaktivität, Workflow, Unterstützung, Ergebnis), indem sie reale Daten aus Curriculum/Competencies/Mastery/Progress/Readiness laden statt aus `SystemConsciousness` (LocalStorage-Defaults).

## Strategie

Nicht die Pages umschreiben — stattdessen einen **DB-Bridge-Layer** zwischen vorhandenen Hooks (`useDashboardSummary`, `useCourseProgress`, `useExamReadiness`, `useReEntryState`, `useRecoveryPlan`, `fetchWeaknessMap`, `computeReadiness`) und `useSystemConsciousness` einziehen. Damit bleiben alle 2.633 Zeilen Page-Code stabil, aber die Werte sind real.

```text
DB ──► useLearnerRealityBridge ──► hydrate(SystemConsciousness)
                                 └► expose normalized snapshot { readiness, weakKompetenzen, nextStep, lastActivity }
```

## Schritte

### 1. Neuer Hook: `src/hooks/useLearnerRealityBridge.ts`
- Liest `useDashboardSummary` → active_curriculum_id
- Liest `useExamReadiness(curriculumId)` → `overall_readiness`, `weak_competencies`, `readiness_level`
- Liest `useCourseProgress(courseId)` → `progress_percent`, `next_lesson`, `last_activity`
- Liest `useReEntryState(curriculumId)` → `suggested_action`, `days_since_last`, `streak_current`
- Liest `fetchWeaknessMap(userId, curriculumId)` → top weak/partial/mastered
- Mapped Werte in `SystemConsciousness` via `setReadiness`, `updateRisk`, `recalc`
- Liefert Snapshot `{ ready, hasData, curriculumId, courseId, readiness, weak, mastered, partial, nextStep, lastActivity, reEntry }`

### 2. Mount-Punkt
- `useLearnerRealityBridge()` einmal in `AppLayout` (App-Shell) oder pro Seite einbauen, damit `SystemConsciousness` für alle 4 Pages hydratisiert ist.

### 3. Pro Page: minimal-invasive Ersetzung der Hardcoded-Strings
Jede Page bekommt am Anfang `const reality = useLearnerRealityBridge()` und ersetzt nur die hardcoded Werte (Prozent, Kompetenz-Namen, CTA-Ziel) — restliche UI bleibt.

**`/app/start`**
- ReadinessScore: `reality.readiness`
- PriorityCompetency: `reality.weak[0]`
- CompetencyTrendList: `reality.weak ∪ partial ∪ mastered` (top 5)
- Primärer CTA: `reality.nextStep.deeplink` ("MiniCheck starten" / "Lektion fortsetzen")
- Empty-state wenn `!reality.hasData`: Onboarding-CTA zu `/app/lernpfad`

**`/app/kompetenz`** (Liste, ohne `:competencyId`)
- Zeigt `weak | partial | mastered` aus `fetchWeaknessMap`
- CTA pro Zeile: "Kompetenz trainieren" → `/app/kompetenz/<id>`

**`/app/tutor`** (Entry-Surface)
- "Letzte Schwäche": `reality.weak[0]` → Tutor-Deeplink `/app/tutor?focus=<competencyId>`
- "Letzter Fehler": `reality.lastActivity` (Lesson + status)
- Empty-state wenn keine Schwächen: generischer Einstieg

**`/app/lernpfad`**
- Priorisierte Kompetenzliste = `reality.weak` (sortiert nach `score` asc)
- "Nächster Schritt" = `reality.nextStep` (von `next_lesson` oder `suggested_action`)
- CTA: "Lernschritt öffnen" → Deeplink

### 4. Empty-/Loading-States (QFAF Pflicht)
- Loading: Skeleton-Karten (keine fake Werte)
- Kein Curriculum aktiv: CTA "Beruf wählen" → `/berufe`
- Curriculum ohne Progress: CTA "Erste Lektion starten" → `next_lesson`

### 5. Audit-Hook
- Beim Hydrate ein Event in `tracking_events` schreiben: `learner_reality_hydrated { curriculum_id, readiness, weak_count, surface }` — Vorbereitung für Sprint 2.
- Bei `!hasData` ein `auto_heal_log`-Eintrag `learner_reality_empty` (für Repair-Backlog).

### 6. QFAF-Abnahme pro Page
Checkliste in PR-Body: 6/6 Fragen mit „Ja". Wenn ein „Nein" bleibt → Repair-Task in `auto_heal_log`.

## Nicht-Ziele Sprint 1
- Kein neues Event-Schema-Sweep (Sprint 2)
- Kein Admin-Hardening (Sprint 3)
- Keine neuen DB-Tabellen — alle RPCs existieren bereits
- Kein Redesign der 4 Pages — nur Daten-Substitution

## Technische Details

**Geänderte Dateien (~6)**
- `src/hooks/useLearnerRealityBridge.ts` (neu)
- `src/pages/app/AppStartPage.tsx`
- `src/pages/app/AppLernpfadPage.tsx`
- `src/pages/app/AppTutorPage.tsx`
- `src/pages/app/AppKompetenzPage.tsx`
- `src/lib/system/SystemConsciousness.tsx` (kleiner `hydrate()`-Helper)

**RPCs (alle vorhanden):**
`get_dashboard_summary`, `calculate_exam_readiness`, `get_course_progress`, `learner_get_re_entry_state`, `compute_readiness`, `fetchWeaknessMap` (v_user_weakness_map).

**Verifikation:**
- Manueller Smoke per `browser--view_preview` auf `/app/start`, `/app/lernpfad`, `/app/tutor`, `/app/kompetenz` als Test-Learner.
- Reality-Test ergänzen: `tests/customer-reality/learner/13-reality-bridge.spec.ts` prüft, dass keine der 4 Pages den Default-Wert `readiness=50` aus `SystemConsciousness` zeigt.

## Reihenfolge
1. Bridge-Hook + SystemConsciousness `hydrate()`
2. `/app/start` (einfachster Page-Patch, Validierung des Pattern)
3. `/app/lernpfad`
4. `/app/kompetenz`
5. `/app/tutor`
6. Reality-Spec + QFAF-Checkliste im Plan-Report

Geschätzter Umfang: 1 großer Commit, ~600 LOC netto (Bridge + Patches).

Bestätige, dann fange ich mit Schritt 1 (Bridge-Hook) an.
