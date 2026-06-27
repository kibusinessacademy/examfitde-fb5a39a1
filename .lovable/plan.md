
# EXAMFIT.DESIGN.SYSTEM.OS.1 — Wave 2 + 3 Rollout

Großes Paket. Wave 1 (Tokens + Primitives in `src/components/examfit-ds/`) ist live. Jetzt: konsistente Anwendung über die wichtigsten Lern- und Verkaufsflächen. **Keine LIF/Curriculum/Pricing-Logik anfassen — nur Presentation-Layer.**

## Reihenfolge & Scope

### Schritt 1 — Lesson HeroSurface-Header (P0, höchster Lernimpact)
- Neuer `src/components/lesson/LessonHeroHeader.tsx` auf Basis `<HeroSurface area="learn">`.
- Slots: Kurs-/Modul-Breadcrumb, `<ProgressMeter shape="bar" showPercent>` plus „Lektion X von Y", `<FloatingChip variant="time">` Restdauer, Back/Home-Buttons.
- `src/components/lesson/LessonHeader.tsx` bleibt als Fallback exportiert; `LessonPlayer.tsx` rendert neuen Header.
- Sticky verhalten erhalten, `prefers-reduced-motion` safe.
- Tests: Snapshot + a11y (progressbar role, „Lektion X von Y" sichtbar).

### Schritt 2 — Tutor- und Oral-Exam-Seiten DS2.0-Pass
- `src/pages/AiTutorPage.tsx` (bzw. Tutor-Surface): Hero-Block via `<HeroSurface area="tutor">`, Status-/Modus-Chips via `<FloatingChip variant="tutor">`, sekundäre Panels in `<GlassPanel>`. Keine Änderung an Chat-Logik.
- `src/pages/OralExamTrainer.tsx` (bzw. Hauptseite des Oral-Trainers): `<HeroSurface area="oral">` für Header, Topic-/Mic-Status als `<FloatingChip variant="oral">`, Voice-Diagnostics-Box als `<GlassPanel>`. Keine Logik an Voice/SSE.
- Shop: `/examfit`-Landing + `/berufe`-Hub und `ProductHeroSection`: Hero auf `<HeroSurface area="shop">` mappen, Trust-/Pricing-Chips via `<FloatingChip>`. Pricing-Texte unverändert (24,90 € SSOT).

### Schritt 3 — Learning Dashboard mit großen Cards
- Neue Seite `src/pages/dashboard/LearningDashboardPage.tsx`, gemountet unter bestehender Dashboard-Route (`/dashboard` bzw. `/app`), `AppCoursesPage` als Tab erhalten.
- 6 große `<ImageCard>`s:
  1. Lernkurs → `/app/learn`
  2. Prüfung (Simulation) → `/app/exam`
  3. KI-Tutor → `/app/tutor`
  4. Mündliche Prüfung → `/app/oral`
  5. Fortschritt (mit `<ProgressMeter shape="ring" showPercent>`)
  6. Schwächen (Top-Fehler-Topics, read-only Liste)
- Fallback-Gradient pro Karte über `fallbackArea`. Daten kommen aus bestehenden Hooks (`useAccountSummary`, vorhandene Progress-Selectors) — keine neuen Queries.

### Schritt 4 — Kompetenzkarten (ImageCard-Layouts)
- Neuer `src/components/competence/CompetenceImageCard.tsx`: 3 Modi `course | exam | tutor` (steuert `fallbackArea` + Action-Label).
- `topRight`-Slot: `<FloatingChip variant="fav">` (Favorit-Toggle, lokaler State) + `<FloatingChip variant="time">` mit geschätzter Dauer.
- Eingesetzt in: Kompetenzliste auf `/app/learn`, Prüfungs-Topic-Auswahl, Tutor-Themenpicker. Bilder via vorhandenem `useBerufImages` / Kompetenz-Image-Hook (Fallback Gradient).

### Schritt 5 — Guards & Tests
- Vitest:
  - `LessonHeroHeader` Render + Progress-Rolle
  - `CompetenceImageCard` Variants + Chips
  - `LearningDashboardPage` rendert 6 Karten, jede mit `data-testid="examfit-image-card"`
- `scripts/guard-no-raw-hex.mjs` auf neue Pfade erweitern (`src/components/lesson/LessonHeroHeader.tsx`, `src/components/competence/**`, `src/pages/dashboard/LearningDashboardPage.tsx`).
- LIF-Guards bleiben grün: `LearnerAnswerSurface` weiter einzige Antwort-Komponente.

## Technische Constraints

- Keine Hex-Werte. Nur `bg-hero-*`, `rounded-card-*`, `shadow-card|hero`, `status-*` Tokens.
- Kein Refactor an: LIF.OS.1, Curriculum, Pricing, Stripe, Auth, RLS, Edge-Functions.
- Keine neuen Routen — bestehende Dashboard-Route übernimmt das neue Layout, vorherige Inhalte als Tab/Sub-View.
- Mobile-first (411px Viewport getestet), Bottom-Actions stabil.
- Wave 4 (Motion-Feedback) ausdrücklich NICHT in diesem Paket.

## Ergebnis
Ein durchgängiges DS2.0-Erscheinungsbild über Lesson · Tutor · Oral · Shop · Dashboard, mit konsistenten Hero-, Glass-, Chip- und Card-Komponenten — ohne Eingriff in Fach- oder Interaktionslogik.
