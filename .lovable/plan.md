# Sprint Plan: Prüfungsreife Phase 2 + Funnel-Hardening

Fünf eigenständige Mini-Sprints, in dieser Reihenfolge.

## 1. MC-Korrektheit als zweite Score-Achse

**Hintergrund:** Phase 1 lädt echte `exam_questions` per RPC, nutzt aber nur die 0–3 Selbsteinschätzung. Die `options` (mit `is_correct`) werden ignoriert.

**Umsetzung (frontend-only, additiv):**
- `useDiagnosticSet`: Mappe `options[]` und `correct_option_index` zusätzlich auf `Question` (neuer optionaler Block `mc?: { options: string[]; correctIndex: number }`).
- `QuizQuestionCard`: Wenn `question.mc` vorhanden → render zwei Stages:
  1. MC-Auswahl (Radio, 4 Optionen, Validierung gegen `correctIndex`)
  2. Selbsteinschätzung 0–3 wie bisher
  Sonst: nur Selbsteinschätzung (Generic-Pfad).
- `PruefungsreifeCheckPage`: Sammle `mc_correct: boolean | null` pro Antwort. Compute `mc_score_pct = correct/answered*100`. Übergib in `quiz_completed.metadata` als Feld `mc_score_pct` und `mc_answered_count`. Self-Assessment-Score bleibt primär (kein Score-Rewrite).
- Keine neuen Events. RPC unverändert (returnt schon `options` + `correct_option_index`).

**Tests:** `useDiagnosticSet.test.tsx` erweitert um MC-Mapping. `pruefungsreife-keyboard.test.tsx` deckt MC-Auswahl per Tab/Enter ab.

## 2. Admin-Filter `question_source` (blueprint vs generic)

**In `PruefungsreifeFunnelCard.tsx`:**
- Toggle-Group `Alle | Blueprint | Generic` über der Funnel-Tabelle.
- Filter wirkt clientseitig auf bereits geladene Events (filter `metadata->>question_source`).
- Detailzeile: Pro Segment Conversion-Rate `quiz_started → quiz_completed`, Avg-Score, Avg-`mc_score_pct` (sofern vorhanden).
- Keine RPC-Änderung — bestehender Hook liefert metadata mit.

## 3. Tracking-Contract-Vitest

Neue Datei `src/test/funnel/quiz-tracking-contract.test.ts`:
- Mock `trackFunnel`/`emitFunnelEvent`.
- Render `PruefungsreifeCheckPage` mit `packageId=null` → assert: nur `lead_magnet_view` mit `metadata.stage` ('start'/'completed'), kein `quiz_started`/`quiz_completed`.
- Render mit gemockter Blueprint-RPC + `packageId='uuid'` → assert: `quiz_started` und `quiz_completed` werden mit `package_id`, `persona`, `source_page` aufgerufen.
- Allowlist-Vergleich: Importiere `EDGE_ALLOWED_EVENTS` aus `devTrackingCheck.ts` und assertiere, dass `FUNNEL_EVENTS.QUIZ_STARTED/_COMPLETED` enthalten sind.

## 4. Playwright Screenshot-Trigger

Workflow `mobile-funnel-screenshots.yml` existiert bereits mit `workflow_dispatch`. Ergänze:
- Input `target_url` (default `https://examfitde.lovable.app`) → in `PREVIEW_URL` env.
- Kurzer Hinweis in `artifacts/mobile-funnel-screenshots/FINDINGS.md` wie der Trigger via GitHub UI gestartet wird.

## 5. Visual-Audit Produktsuche

Nach Trigger der Screenshots: Sichte `02-home-demo-gallery-pending`, `10/11/12-bundle-*`, `13-admin-growth-pending` plus neue Shots `06-quiz-start-*` (mit MC). Schreibe konkrete UI/UX/Copy/Layout-Findings in `FINDINGS.md` Sektion „Produktsuche & Bundle-Detail".
- Erwartete Themen: Filter-Chips Touch-Target, Eyebrow-Konsistenz, CTA-Hierarchie, Module-Cards Zeilenabstand, Comparison-Table horizontaler Scroll.

## Aus dem Scope (Phase 3)

- Admin-RPC-Erweiterung um `mc_score_pct`-Aggregation (jetzt nur clientseitig sichtbar).
- IRT-basierte adaptive Auswahl.
- A/B-Testing Blueprint-vs-Generic Conversion automatisch.

**Risiken:** MC-Stage verändert die Quiz-Dauer (~doppelt so viele Klicks pro Frage). Mitigation: Stage 1 (MC) auto-advance, Stage 2 (Selbsteinschätzung) bleibt 1-Klick.

OK so?