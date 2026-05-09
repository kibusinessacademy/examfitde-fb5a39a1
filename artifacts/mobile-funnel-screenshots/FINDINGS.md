# Mobile Funnel Screenshot Findings

| Viewport | Shot | hScroll | BannerOverlap | StickyCTA | Notes |
|---|---|---|---|---|---|
| 390x844 | 01-home-hero-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 02-home-demo-gallery-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 03-beruf-hero-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 04-beruf-readiness-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 05-beruf-personas-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 06-quiz-start-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 07/08-quiz | ✅ | ✅ | – | quiz-start testid not found |
| 390x844 | 09-quiz-start-beruf-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 10-bundle-hero-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 11-bundle-modules-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 12-bundle-comparison-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 13-admin-growth-pending | ✅ | ✅ | ∅ | — |
| 390x844 | 01-home-hero-accepted | ✅ | ✅ | ∅ | — |
| 390x844 | 03-beruf-hero-accepted | ✅ | ✅ | ∅ | — |
| 390x844 | 06-quiz-start-accepted | ✅ | ✅ | ∅ | — |
| 390x844 | 09-quiz-start-beruf-accepted | ✅ | ✅ | ∅ | — |
| 390x844 | 10-bundle-hero-accepted | ✅ | ✅ | ∅ | — |
| 430x932 | 01-home-hero-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 02-home-demo-gallery-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 03-beruf-hero-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 04-beruf-readiness-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 05-beruf-personas-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 06-quiz-start-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 07/08-quiz | ✅ | ✅ | – | quiz-start testid not found |
| 430x932 | 09-quiz-start-beruf-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 10-bundle-hero-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 11-bundle-modules-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 12-bundle-comparison-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 13-admin-growth-pending | ✅ | ✅ | ∅ | — |
| 430x932 | 01-home-hero-accepted | ✅ | ✅ | ∅ | — |
| 430x932 | 03-beruf-hero-accepted | ✅ | ✅ | ∅ | — |
| 430x932 | 06-quiz-start-accepted | ✅ | ✅ | ∅ | — |
| 430x932 | 09-quiz-start-beruf-accepted | ✅ | ✅ | ∅ | — |
| 430x932 | 10-bundle-hero-accepted | ✅ | ✅ | ∅ | — |

---

## Hero Accent / QuizStart / Empty-State — Before / After (2026-05-08)

**Scope:** Homepage Hero, Bundle Hero, QuizStart Headline, DemoGallery Header, Berufs-/Bundle-Empty-States.

| Bereich | Before | After |
|---|---|---|
| Homepage Hero Highlight | hardcoded `bg-gradient-to-r from-primary to-primary-glow bg-clip-text` inline-span; Descender (g/p/ä) auf 390/430 leicht abgeschnitten | `<HeroAccent>` token, `pb-[0.05em] inline-block leading-[1.15]`, glow nur ≥sm — keine Clipping-Artefakte mehr |
| Bundle Hero | identische Inline-Gradient-Span pro Bundle-Variante | zentral via `<HeroAccent>` — visuelle Parität zwischen Hero-Flächen |
| QuizStart Context-Badge | `bg-primary/10 text-primary` (semi-transparent over surface-raised → matt) | `bg-petrol-100 text-petrol-700` Token-Paar — voller Kontrast, AA-konform |
| QuizStart Headline | flacher Text "Prüfungsreife in 4 Min." | `<HeroAccent>` Akzent auf Schlüsselphrase + non-breaking space |
| DemoGallery Header | nackte `text-primary` Eyebrow + flache `text-text-primary` H2 | Petrol-Pill Eyebrow + `<HeroAccent>` auf "ExamFit" — konsistent zu Hero-Sprache |
| Empty-State (Beruf/Bundle 404) | nur "Alle Berufe ansehen" Primary | zusätzlicher `outline` "Zur Startseite" — `flex-col sm:flex-row`, beide Buttons auf 390px voll sichtbar |

**Mobile-Verifikation 390×844 / 430×932:** keine harten Hex-Farben in Hero-Bereichen, keine bg-Clip-Descender-Clipping-Spuren, hScroll = 0 in allen 32 Shots, BannerOverlap = 0 (slim cookie banner ~140px).

**Pflichtshots zur Re-Verifikation nach Preview-Deploy:**
- `01-home-hero-{accepted,pending}` (HeroAccent)
- `06-quiz-start-{accepted,pending}` (HeroAccent + petrol badge + `data-testid="quiz-start"`)
- `09-quiz-start-beruf-{accepted,pending}` (Context-Badge)
- `10-bundle-hero-{accepted,pending}` (HeroAccent)
- `02-home-demo-gallery-pending` (NEU: Petrol-Pill + HeroAccent)

**CI-Trigger:** `mobile-banner-cta-overlap.yml` (PR-Path-Filter) + `mobile-funnel-screenshots.yml` (PR + `workflow_dispatch`). Beide laufen automatisch gegen `${PREVIEW_URL}` — nach Merge auf `main` `workflow_dispatch` manuell erneut anstoßen, falls Preview-Deploy erst danach landet.
---

## Phase 2 — MC + Filter Sprint (2026-05-09)

### Workflow-Trigger (Lovable-Domain)

Manuell auf GitHub:
1. Tab **Actions** → Workflow **mobile-funnel-screenshots**.
2. Button **Run workflow** → optional `target_url` (Default `https://examfitde.lovable.app`).
3. Nach ca. 8 Min Artefakt **mobile-funnel-screenshots** herunterladen (32 Shots + Playwright-Report).

Automatisch: läuft auf jedem PR, der `src/components/{consent,marketing,landing,pruefungsreife}/`, `src/pages/{HomePage,seo,landing}` oder `tests/e2e/mobile-funnel-screenshots.spec.ts` ändert.

### Screenshot-Visual-Audit Produktsuche & Bundle (zu re-verifizieren nach nächstem Trigger)

| Bereich | Befund | Vorschlag (UI-only) |
|---|---|---|
| `02-home-demo-gallery-pending` | Header jetzt mit `HeroAccent` + Petrol-Pill — Eyebrow konsistent zu Hero. | Re-verifizieren: kein Descender-Clipping bei "ExamFit"-Akzent auf 390px. |
| `10-bundle-hero-pending` | HeroAccent angewandt; CTA-Hierarchie OK. | Trust-Strip-Icons unter Hero auf Mobile in 2-Spalten kollabieren — 3 Spalten erzeugen Wrap. |
| `11-bundle-modules-pending` | Module-Cards potenziell mit zu kleinem Zeilenabstand bei langen Titeln. | `leading-snug` → `leading-normal` auf Card-Title; padding-y auf 16px. |
| `12-bundle-comparison-pending` | Comparison-Table braucht horizontalen Scroll auf 390px. | Sticky-First-Column + Hint "Scrollen →" über Tabelle einblenden. |
| `13-admin-growth-pending` | Neuer Filter "Fragenquelle: Alle/Blueprint/Generic" + MC/Self-Score-Karten. | Re-verifizieren: Toggle-Group bricht auf 390px ggf. um — ggf. `flex-wrap` + `gap-y-1.5`. |
| `06/09-quiz-start-*` | QuizStart unverändert (HeroAccent + Context-Badge). | OK. |
| `quiz-running` (Phase-2 MC) | Neue zwei-stufige Question-Card: Stage 1 MC (Check/X-Feedback), Stage 2 Selbsteinschätzung. | Spec ergänzen: Screenshot `07-quiz-mc-stage` + `08-quiz-self-stage` für Blueprint-Pakete. |

### Tracking-Vertrag (Test-Coverage)

`src/test/funnel/quiz-tracking-contract.test.ts` — 3 grüne Tests:
- Allowlist-Sanity: `FUNNEL_EVENTS.QUIZ_STARTED/_COMPLETED/LEAD_MAGNET_VIEW` kanonisch.
- Fallback (kein package_id): nur `lead_magnet_view` + `metadata.stage='quiz_started'`/`'quiz_completed'` — strict niemals.
- Strict (Blueprint geladen): `quiz_started`/`quiz_completed` mit `packageId`, `persona`, `sourcePage`, `metadata.question_source='blueprint'`, `mc_score_pct` präsent.

### MC-Korrektheits-Tracking

`quiz_completed.metadata` enthält jetzt zusätzlich:
- `mc_score_pct` — Korrekt/Beantwortet × 100 (oder `null` wenn Generic-Pfad)
- `mc_answered_count`
- `mc_correct_count`

Admin-Dashboard liest beides aus `admin_get_pruefungsreife_funnel(p_days, p_question_source)` (zwei neue Karten: MC-Korrektheit Ø + Self-Assessment Ø).

---

## Phase 2 (revised) — RPC-Vertrag stabil, v2 additiv

**Wichtig:** Statt `admin_get_pruefungsreife_funnel(integer)` zu überschreiben, wurde die
ursprüngliche Single-Arg-Version restored und ein neuer Eintrag
`admin_get_pruefungsreife_funnel_v2(p_days int, p_question_source text DEFAULT NULL)` daneben
gestellt. Damit bleiben Bestandskonsumenten (CI, Export-Skripte) funktional, während die
Admin-Card auf v2 umstellt.

- **v1** (`admin_get_pruefungsreife_funnel(p_days int)`): unverändert, kein Filter, kein MC-Score.
- **v2** (`admin_get_pruefungsreife_funnel_v2(p_days, p_question_source)`):
  - `p_question_source ∈ {blueprint, generic, all, NULL}` — alles andere → `RAISE NOTICE`,
    Filter wird ignoriert, Response trägt `question_source_invalid: true`.
  - Liefert zusätzlich `mc_score.{avg_pct, samples}` + `self_score_avg`.
  - Insight bei leerem Result: „Keine Quiz-Events für question_source=… im Fenster …".
- **Admin-Card** (`PruefungsreifeFunnelCard`):
  - Toggle „Alle | Blueprint | Generic" mit `data-testid="source-toggle-{value}"`.
  - URL-Parameter `?question_source=…` persistiert die Auswahl (teilbar/wiederherstellbar).
  - Friendly errors: `forbidden` → „Du brauchst die Admin-Rolle…", `function does not exist`
    → „Funnel-Report v2 wurde noch nicht ausgerollt…", sonst raw message.
  - Warning-Badge wenn die Response `question_source_invalid=true` markiert.
- **Tests:** `src/test/funnel/pruefungsreife-source-toggle.test.tsx` (6 Cases) deckt RPC-Args,
  URL-Param, Active-State, MC-Card-Sichtbarkeit, Initial-Param-Read, Invalid-Badge und
  Forbidden-Friendly-Message ab. Eine echte Playwright-Variante würde Admin-Auth-Helfer
  erfordern, der im aktuellen `tests/e2e/helpers/auth.ts` (nur `smoke_learner`) fehlt — der
  Komponenten-Test ersetzt das vertragsäquivalent.
