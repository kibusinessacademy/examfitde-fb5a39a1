## Wave 3 — Dashboard & Kartenmigration

Reines UI/UX-Refactor auf die bestehenden examfit-ds Primitives (`HeroSurface`, `ImageCard`, `FloatingChip`, `GlassPanel`, `ProgressMeter`, `LearnLessonCard`). Keine Änderungen an Daten, Hooks, RLS, Curriculum, Unlock, Paywall, LIF.OS.1 oder API.

### Scope-Übersicht (Surfaces)

| Surface | Datei | Wave-3-Aktion |
|---|---|---|
| Dashboard | `src/pages/LearnerDashboard.tsx` | Personalisierte HeroSurface („Willkommen zurück" + Prüfungsreife + nächstes Lernziel + Continue-CTA) und `LearningDashboardGrid` mit 6 ImageCards (Weiterlernen / Prüfung / Tutor / Mündlich / Fortschritt / Schwächen) |
| Kursübersicht | `src/pages/CoursesPage.tsx` | HeroSurface-Header + Liste auf ImageCard (Bild, Titel, Kurzbeschreibung, ProgressMeter, FloatingChips, CTA „Weiterlernen") |
| Kursdetail | `src/pages/CourseDetailPage.tsx` | HeroSurface-Header (Bild, Beruf, Chips), Module/Kompetenzen-Block bleibt funktional, ersetzt nur Hülle/Badges durch ImageCard + FloatingChip |
| Berufsdetail | `src/pages/berufos/*` (BerufeBerufPage o. ä.) + `BerufOSHub.tsx` | HeroSurface + ImageCard-Grid für Kurse/Module |
| Lernübersicht | falls vorhanden (`Learn*Page`) | HeroSurface-Wrapper |

### Teil C — FloatingChip Standardvarianten

Ergänzung `FloatingChip` um feste, dokumentierte Variants:
`kurs · ihk · pruefung · tutor · muendlich · neu · empfohlen · dauer · schwierigkeit · fortschritt · ki`

Alle bestehenden `<Badge>`/Inline-Pills in den migrierten Surfaces werden ersetzt. **Außerhalb der migrierten Seiten bleibt `Badge` zunächst stehen** (Wave 4-Cleanup), damit Wave 3 freezeable bleibt.

### Teil G — Spacing Token Pass

Einheitliche Container-Klassen für migrierte Seiten:
- Page-Container: `container mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-10 sm:space-y-14`
- Card-Grids: `gap-6 sm:gap-8 grid-cols-1 md:grid-cols-2`
- Hero → Grid: `mb-10 sm:mb-14`

### Personalisierter Dashboard-Hero (Empfehlung übernommen)

`DashboardHero`-Komponente (neu, unter `src/components/dashboard/DashboardHero.tsx`):
- linke Spalte: „Willkommen zurück, {name}" + nächstes Lernziel (Lesson-Title) + Continue-CTA (Deep-Link zur letzten Lesson)
- rechte Spalte: ProgressMeter „Prüfungsreife" + Mastery-%

Daten kommen ausschließlich aus bereits vorhandenen Hooks (`useLearnerProgress`, `useExamReadiness`, vorhandene Queries) — keine neuen Requests.

### CI / Guards

- `scripts/guard-no-raw-hex.mjs` bleibt aktiv (kein `#RRGGBB` in examfit-ds-Primitives).
- Neuer Soft-Guard: `scripts/guard-card-family.mjs` warnt (nicht fail), wenn in `src/pages/{LearnerDashboard,CoursesPage,CourseDetailPage,berufos/**}` direkte `<Card>`-Imports aus `@/components/ui/card` auftauchen — Liste schrittweise leeren.

### Tests

- Vitest Snapshot/Behavior:
  - `LearningDashboardGrid` (6 Karten, korrekte CTAs, ARIA-Labels)
  - `DashboardHero` (Fallback-Name, fehlendes nächstes Ziel, Continue-CTA disabled)
  - `FloatingChip` Variant-Matrix
  - `CoursesPage` Card-Renderer (ProgressMeter & Chips)
- Playwright Mobile-Suite erweitern um Routen `/dashboard`, `/kurse`, `/berufe/<slug>`:
  - 4 Viewports × 2 Themes
  - Asserts: kein horizontaler Overflow, alle CTAs ≥ 44px, alle `<img>` haben `alt`
- Akzeptanz: alle Vitest grün, Playwright `overflow=False` über alle 24 Runs

### Accessibility

- Buttons in den neuen Karten: `min-h-11 min-w-11`
- Alle Hero/Card-`<img>`: `loading="lazy"` + verbindlicher `alt`
- Hover-Lift + Focus-Ring (Tailwind `focus-visible:ring-2 ring-ring`)
- Kontrast wird über bestehende Tokens (`text-foreground` auf `bg-card`) garantiert

### Out-of-Scope (explizit nicht angefasst)

- `LessonPlayer` (Wave 2 freeze)
- Curriculum, Unlock-Logik, Paywall
- Datenmodelle, Edge Functions, RLS
- Globale Badge-Verdrängung außerhalb der migrierten Surfaces (Wave 4)
- Motion/Microinteractions (Wave 4)

### Reihenfolge der Umsetzung

1. `FloatingChip`-Variants + Tests
2. `DashboardHero` Komponente + Tests
3. `LearnerDashboard.tsx` Migration (Hero + Grid)
4. `CoursesPage.tsx` Migration
5. `CourseDetailPage.tsx` Hero + Hülle
6. Berufsseiten (`BerufOSHub` + Detail)
7. Spacing-Pass über alle migrierten Seiten
8. Vitest + Playwright Wave-3-Run, Report nach `/mnt/documents/wave3-mobile-qa/`
9. Memory-Update: Wave 3 freeze
