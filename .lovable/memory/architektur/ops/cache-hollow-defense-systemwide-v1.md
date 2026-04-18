---
name: Cache Hollow-Defense (systemwide)
description: Generische Hollow-Detection in checkCache + storeInCache verhindert Cache-Poisoning und Retry-Stürme über alle Job-Typen.
type: feature
---

# Cache Hollow-Defense — systemweit

## Kontext / Incident
2026-04-18: `package_generate_glossary` lief in 8/8 Retries (HTTP 500), weil
`profession_glossaries` einen substanzlosen Cache-Hit lieferte, der die
Post-Condition `HOLLOW_GLOSSARY` (entries ≥ 1, token_count ≥ 100) reißt.
Fix initial nur in `glossary-loader.ts` und `package-generate-glossary/index.ts`.
Audit zeigt: identisches Risiko in `_shared/ai-gateway/cache.ts` für **alle**
Konsumenten (lesson-gen/process-lesson.ts, ai-generation-gateway).

## Maßnahme
Zentrale Härtung in `supabase/functions/_shared/ai-gateway/cache.ts`:

### 1. `isCacheBodyHollow(body)` — generische Heuristik
- body muss object sein
- serialized length ≥ 200 Bytes
- wenn `html` Feld → > 200 chars
- wenn `questions`/`items`/`entries` Array → non-empty
- wenn `choices[]` (OpenAI-Shape) → erste Choice Content > 100 chars

### 2. `checkCache()` — Auto-Invalidierung
Erkennt der Check ein hollow body, wird der Eintrag sofort **gelöscht**
(best-effort, fire-and-forget) und `{ found: false }` zurückgegeben.
Dadurch regeneriert der nächste Aufruf frisch statt den Loop zu wiederholen.

### 3. `storeInCache()` — Source-Defense
Refused hollow bodies VOR dem Insert. Verhindert das Vergiften des Caches
an der Quelle, falls Generator-QC versagt.

## Wirkung
- Glossary-spezifische Detection (token_count, entries) bleibt zusätzlich
  erhalten für berufs-glossar-spezifische Schwellen.
- Generic Defense wirkt für lesson_generate_content, exam-pool, handbook
  etc. ohne per-job Wissen.
- False Positives kosten max. 1 Regeneration; False Negatives (alter Stand)
  kosten Retry-Exhaustion + HTTP 500 → asymmetrisch zugunsten Defense.

## Files
- `supabase/functions/_shared/ai-gateway/cache.ts` (export `isCacheBodyHollow`)
