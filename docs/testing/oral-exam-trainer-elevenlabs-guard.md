# OralExamTrainer — ElevenLabs Removal Guard Coverage

Stand: 2026-06-03

Der **OralExamTrainer** (`src/pages/OralExamTrainer.tsx`) ist per Architekturentscheidung
**browser-native** (Web Speech API + `speechSynthesis`) und darf zu **keinem Zeitpunkt**
wieder eine ElevenLabs-Abhängigkeit erhalten — weder im Quelltext, in Edge Functions,
im gerenderten DOM noch in Netzwerk-Responses.

Diese Datei dokumentiert dauerhaft, **welche Tests** das absichern und **wo sie laufen**.

## Memory-Bezug
- `mem://features/examfit/oral-trainer-cinematic-voice` — Browser-native STT/TTS
- Constraint: keine `oral-voice-*` Edge Functions, kein ElevenLabs SDK / API-Key

## Test-Matrix

| Ebene | Datei | Assertions | CI-Job |
|---|---|---|---|
| Unit (Quelltext, fokussiert) | `src/test/oral-exam-trainer-no-elevenlabs.unit.test.ts` | 4 | `ci.yml › unit-tests` (Schritt: *OralExamTrainer ElevenLabs guard*) |
| Unit (Browser-native Kontrakt) | `src/test/oral-voice-no-elevenlabs.test.ts` | 5 | `ci.yml › unit-tests` |
| E2E (DOM + Network) | `tests/e2e/no-elevenlabs.spec.ts` | 2 pro Route × 3 Routen | `e2e-full-journey.yml`, `nightly-qa.yml` |

### Unit — `oral-exam-trainer-no-elevenlabs.unit.test.ts`
1. Quelltext enthält **keine** Substring `"elevenlabs"` (case-insensitive).
2. Quelltext enthält **kein** `ELEVENLABS_API_KEY`.
3. **Keine Zeile** — inkl. Kommentaren — matcht `/elevenlabs/i`. Fehlertext listet alle Offender mit Zeilennummer.
4. **Kein** Verweis auf `api.elevenlabs.io` / `elevenlabs.io`.

### Unit — `oral-voice-no-elevenlabs.test.ts`
1. `OralExamTrainer` ohne ElevenLabs-Referenz und ohne `ELEVENLABS_API_KEY`.
2. Keine Calls an `oral-voice-tts` / `oral-voice-stt` Edge Functions.
3. Nutzt `webkitSpeechRecognition` + `speechSynthesis` (positiver Kontrakt).
4. Clientseitiger `evaluateTranscriptQuality` Quality-Gate vorhanden.
5. Edge Functions `supabase/functions/oral-voice-{tts,stt}` existieren **nicht**.

### E2E — `tests/e2e/no-elevenlabs.spec.ts`
Für jede Route in `[ '/', '/muendliche-pruefung', '/oral-exam' ]`:
- **DOM-Assertion**: Gerendertes HTML matcht nicht `/elevenlabs/i`.
- **Network-Assertion**: Keine erfasste Response-URL oder Response-Body (text/json/js/html/xml) matcht `/elevenlabs/i`. Fehler-Report enthält URL + 80-Zeichen-Snippet.

Routen mit Status ≥ 500 werden weich übersprungen (Soft-Skip), damit reine
Deployment-Ausfälle nicht als ElevenLabs-Regression erscheinen.

## CI-Integration

`.github/workflows/ci.yml` (Job `unit-tests`) führt **nach** dem regulären
`vitest run` einen expliziten zweiten Schritt aus, der ausschließlich die
beiden Guard-Suites laufen lässt — so erscheint ein Fail dort sofort
isoliert im Job-Log und im `$GITHUB_STEP_SUMMARY`.

```yaml
- name: OralExamTrainer ElevenLabs guard (explicit)
  run: |
    npx vitest run \
      src/test/oral-exam-trainer-no-elevenlabs.unit.test.ts \
      src/test/oral-voice-no-elevenlabs.test.ts \
      --reporter=verbose
```

Der E2E-Spec läuft Teil der vorhandenen Playwright-Suiten
(`tests/e2e/**/*.spec.ts`) — also in `e2e-full-journey.yml` und
`nightly-qa.yml`, ohne dass separate Workflow-Pfade nötig sind.

## Coverage-Sichtbarkeit
- Job-Summary in jedem PR-Run (`### 🎙️ OralExamTrainer ElevenLabs Guard`).
- Playwright-Reports (`playwright-report/`, `test-results/`) werden als Artifacts hochgeladen.

## Lokal ausführen
```bash
# Unit-Guard
npx vitest run \
  src/test/oral-exam-trainer-no-elevenlabs.unit.test.ts \
  src/test/oral-voice-no-elevenlabs.test.ts

# E2E-Guard (gegen Preview)
E2E_TARGET=preview npx playwright test tests/e2e/no-elevenlabs.spec.ts
```
