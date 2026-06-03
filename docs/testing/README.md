# ExamFit Testing — Zentrales README

Stand: 2026-06-03

Dieses Dokument ist die **zentrale Einstiegsseite** für alle Test-Ebenen
(Unit, Integration, E2E, Reality-QA) sowie für die dauerhaft dokumentierten
Test-Matrizen einzelner kritischer Features.

## Test-Ebenen im Überblick

| Ebene | Tool | Speicherort | CI-Workflow |
|---|---|---|---|
| Unit / Component | Vitest + RTL | `src/test/**`, `src/**/__tests__/**` | `.github/workflows/ci.yml` › `unit-tests` |
| Edge Functions | Deno test | `supabase/functions/**/*.test.ts` | `.github/workflows/ci.yml` |
| E2E (Playwright) | Playwright | `tests/e2e/**`, `tests/customer-reality/**` | `e2e-full-journey.yml`, `nightly-qa.yml` |
| Reality-QA (Daily) | Playwright + Triage | `tests/customer-reality/**` | `nightly-qa.yml` |

Suite-Profile (Smoke, Sanity, Nightly, UAT, Stripe, …) sind in
[`playwright.config.ts`](../../playwright.config.ts) als `projects`
konfiguriert.

## Dauerhaft dokumentierte Test-Matrizen

- [OralExamTrainer — ElevenLabs Removal Guard Coverage](./oral-exam-trainer-elevenlabs-guard.md)
  Sichert ab, dass `OralExamTrainer` browser-native bleibt und weder
  Quelltext, DOM noch Netzwerk-Responses jemals `/elevenlabs/i` matchen.
  Abdeckung: 2 Unit-Suites + 1 E2E-Spec über 3 Routen.

Weitere Bereichs-spezifische READMEs:
- [`tests/e2e/README.md`](../../tests/e2e/README.md) — Struktur & Test-User der E2E-Suite
- [`e2e/README.md`](../../e2e/README.md) — Legacy Sales/Tutor-Smoke gegen Preview
- [`src/test/README.ts`](../../src/test/README.ts) — Frontend-Test-Inventar

## E2E-Checks lokal ausführen

Alle Playwright-Specs nutzen dieselbe `playwright.config.ts` und dieselben
Targets wie CI — lokal reicht es, das gewünschte `E2E_TARGET` zu setzen.

### 1. Einmal-Setup

```bash
# Node-Version aus .nvmrc (24) verwenden
nvm use            # optional, wenn nvm vorhanden
npm ci --legacy-peer-deps
npx playwright install --with-deps chromium
```

### 2. Target wählen

| `E2E_TARGET` | URL |
|---|---|
| `production` | `https://www.examfit.de` |
| `preview` *(default)* | `https://examfitde.lovable.app` |
| `local` | `http://localhost:8080` (vorher `npm run dev`) |

Direkt überschreiben geht jederzeit via `BASE_URL=<url>`.

### 3. Beispiele

```bash
# Gesamte E2E-Suite gegen Preview
npx playwright test

# Nur ein einzelnes Spec (z. B. ElevenLabs-Guard)
E2E_TARGET=preview npx playwright test tests/e2e/no-elevenlabs.spec.ts

# Smoke-Profil aus playwright.config.ts
npx playwright test --project=smoke

# Nightly Full-Journey lokal
E2E_TARGET=preview \
E2E_TEST_USER_EMAIL=... E2E_TEST_USER_PASSWORD=... \
npx playwright test tests/e2e/learner-full-journey.spec.ts

# Unit-Guards (OralExamTrainer)
npx vitest run \
  src/test/oral-exam-trainer-no-elevenlabs.unit.test.ts \
  src/test/oral-voice-no-elevenlabs.test.ts
```

### 4. Reports

- HTML-Report: `playwright-report/` (`npx playwright show-report`)
- JSON-Ergebnisse: `test-results/results.json`
- Screenshots/Videos: `test-results/` (nur bei Failures bzw. Retries)

CI lädt dieselben Ordner als Artifacts hoch (siehe
`e2e-full-journey.yml` → `Upload report` / `Upload artifacts`).
