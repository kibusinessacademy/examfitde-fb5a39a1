## Ziel
Lernende erhalten dasselbe Premium-Gefühl wie der Shop: HeyGen-Berufsbilder, Glass-Badges, Gradient-CTAs, große Hero-Flächen, klare Hierarchie. Token-/Komponenten-SSOT statt Einzelfixes. Plus IA-Anpassungen (neue Sektionen "Weiter lernen", "Heute fällig").

Cut 9 (Oral Visual Feedback) ist bereits geliefert und grün — wird in Welle 2 in den Lesson-Player eingehängt.

## Design-Grammatik (geteilt mit Shop)
- Bilder: `resolveCourseImage()` (explicit → `getBerufImage` → default) mit `COURSE_CARD_SIZES`/`COURSE_HERO_SIZES`, `loading="lazy"`, `decoding="async"`, width/height, kein CLS.
- Karten: Glas-Badges (`text-[11px] px-2 py-0.5`), Preis-/Status-Pills (`whitespace-nowrap`), Gradient-CTAs (`gradient-primary`, `h-10`), `rounded-2xl`, `h-full`, `mt-auto` Footer.
- Tokens: keine hardcoded colors — `text-foreground`, `bg-card/50`, `border`, `text-muted-foreground`. Konsistent mit "examfit-design-system-wave4-frozen-v1".
- Motion: `reveal-up` auf Section-Header, `shimmer` auf Skeletons.

## Welle 1 — Foundation (gemeinsame SSOT)
Neue Module unter `src/components/learner/`:
- `LearnerCourseCard.tsx` — Pendant zu `CoursePremiumCard`, Props: `title`, `progress`, `nextLessonLabel`, `meta`, `image`, `primaryAction`, `secondaryAction`, `priority`. Standard-CTA "Weiter lernen".
- `LearnerSectionHeader.tsx` — Eyebrow + Headline + Subtext + optional Action.
- `LearnerHero.tsx` — Premium Hero (Berufs-/Kursbild, Greeting, KPI-Pills: Lernstreak, offene Aufgaben).
- `LearnerEmptyState.tsx` — geteilt für Listen/Sektionen.
- `LearnerProgressPill.tsx` — Glass-Pill (`x % • y/z Lektionen`).
- `learnerImage.ts` (dünner Reexport von `resolveCourseImage`/`COURSE_*_SIZES` mit Learner-Defaults).

Akzeptanz: Storybook-frei rein-präsentational, keine DB-Reads, voller Tailwind-Token-Stil, Typecheck grün.

## Welle 2 — Lesson-Player + Cut-9-Integration
Dateien: `LessonPlayer*`, `MiniCheck*`, `VisualLearningBlock*`.

- Lesson-Header → neuer `LearnerLessonHero` (kompakt, Bild, Kapitel-Crumbs, Progress-Pill).
- Inhalt: konsistente `prose`-Klassen, `Card`-basierte Mini-Sections, sticky "Weiter"-Bar mit gradient-CTA.
- MiniCheck-Karten: Glas-Badges für Difficulty, gradient-CTA "Antwort prüfen".
- VisualLearningBlock: visuelle Hierarchie an Shop-Karten angeglichen.
- **Cut-9-Einhängung**: `<OralVisualFeedback projection={...}/>` als optionaler Slot unterhalb der Antwortabgabe — erscheint nur wenn `answer_submitted=true` und Projection gegeben. Kein DB-Call im Component, Projection wird von übergeordnetem Trainer-Container injiziert (heute noch nicht verdrahtet → folgt separat).

Akzeptanz: gleicher Daten-Flow, keine Logikänderung, alle existierenden Tests grün.

## Welle 3 — Dashboard + Course-Detail Learner-View + IA
- `/dashboard` und `/learn`:
  - `LearnerHero` mit Berufsbild des aktivsten Kurses.
  - Neue Sektion **"Heute fällig"** (max. 3 Karten: nächste Lektion / fällige Wiederholung) — Datenquelle: bestehende `learner_*`-Hooks (z. B. nächste Lesson aus `progress`, fällige MiniChecks aus bestehender SRS-Quelle, sofern vorhanden; ansonsten reine Reihenfolge "zuletzt offen").
  - **"Weiter lernen"** (max. 6 `LearnerCourseCard`) mit Progress-Pill.
  - **"Alle Kurse"** als responsives Grid.
  - Empty-States via `LearnerEmptyState`.
- Course-Detail Learner-View (`/learn/:slug` o. ä.): Hero mit Berufsbild, Kapitelliste als Premium-Cards (Lektionen-Count, Progress, "Weiter" CTA), klarer Trennung "Nächste Lektion" vs. "Alle Lektionen".

Daten-Vertrag: bestehende Hooks/Selectors weiternutzen, nur Mapping auf neue Card-Props. Keine neuen Edge Functions in dieser Welle.

## Welle 4 — Profil / Einstellungen / Erfolge / Zertifikate
- `Profile`, `Settings`, `Achievements`, `Certificates`-Routen:
  - Section-Header + `Card` mit gleicher Visual-Sprache.
  - Achievement-Karten: HeyGen-/Berufsbild + Glas-Badge.
  - Zertifikate als Premium-Cards mit Download-CTA (`gradient-primary`).
  - Settings: Forms in geclusterten `Card`-Gruppen, sticky Save-Bar.

Akzeptanz: keine Verhaltensänderung, nur Visuelles, alle bestehenden Forms/Aktionen funktional.

## Out of Scope (klar abgegrenzt)
- Keine neuen DB-Tabellen, keine Migrationen, keine neuen Edge Functions in den Wellen 1–4.
- Kein Eingriff in VLO/SSOT-Engines. Cut 9 bleibt wie geliefert.
- Keine Logik-Refactors in Mastery/Progress/Quiz.

## Validierung
- `tsgo --noEmit` grün.
- `bunx vitest run` grün (insb. VLO 117 Tests + neue Snapshot-Tests für `LearnerCourseCard`/`LearnerHero`).
- Playwright Smoke (headless localhost:8080):
  - `/dashboard` rendert "Heute fällig" + "Weiter lernen" + "Alle Kurse" sichtbar.
  - Lesson-Player rendert OralVisualFeedback nur nach Antwortabgabe.
  - Screenshots Desktop + Mobile.

## Reihenfolge
Ich starte mit **Welle 1 (Foundation)** und **Welle 3 Dashboard**, weil dort der größte sichtbare Sprung pro Aufwand entsteht. Welle 2 (Lesson-Player + Cut-9-Slot) folgt direkt danach. Welle 4 zum Schluss.

Sag "go", dann lege ich mit Welle 1 + Dashboard los.
