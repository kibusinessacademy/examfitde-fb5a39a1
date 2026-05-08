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