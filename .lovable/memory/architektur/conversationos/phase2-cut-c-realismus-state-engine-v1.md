---
name: ConversationOS Phase 2 Cut C — Realismus-Boost State Engine
description: Erweiterte linguistic markers + Mikro-State-Atmospheric-Deltas + Cue-Directives im System-Prompt
type: feature
---
# Cut C — Realismus-Boost State Engine (2026-05-27)

## Problem
State-Veränderungen kamen bisher ausschließlich aus Painpoint-Hits — also diskreten Sprüngen. Atmosphäre fehlte: 4 Konjunktive in einem Turn ohne Painpoint-Trigger ließen State unverändert. Druck war binär, nicht graduell.

## SSOT
- `detectUserSignals` erweitert um 14 neue linguistic markers:
  - `high_hedging_density` (≥3 Hedging-Wörter oder >12% des Turns)
  - `subjunctive_cluster` (≥2 distinkte Konjunktiv-II-Verben)
  - `filler_words` (äh/ähm/hm/also halt)
  - `time_stalling` ("lassen Sie mich überlegen", "gute Frage")
  - `self_correction` ("ich meine", "also nein")
  - `apology_words` / `apology_cluster` (≥2 Entschuldigungs-Marker)
  - `uptalk` (Aussage mit ?-Endung, kein W-Frage-Wort)
  - `monologue_length` (wc>80) / `monologue_excessive` (wc>140)
  - `repetition_loop` (5+ char Wort ≥3× im Turn)
  - `name_dropping_no_substance` (≥2 Capitalized Tokens + kein Number + wc<30)
  - `concrete_example` (Positiv-Signal)
  - `substantive_answer` (wc≥20 + because-marker + keine Schwäche-Signale)

- **Mikro-State-Atmospheric-Deltas** `MICRO_DELTAS` (kleine ±0.02–0.06 pro Signal), gecappt auf ±0.12 pro Dimension. Unabhängig von Painpoint-Hit.
- `combinedDelta = painpointDelta + microDelta` → `applyStateDeltas` → State graduell.

## Runtime-Flow
1. `signals = detectUserSignals(...)` — extended set
2. `selectedPp = selectPainpoint(...)` — unverändert
3. `painpointDelta = override?.state_deltas ?? pp.state_deltas`
4. `micro = computeMicroDeltas(signals)` — NEU
5. `combinedDelta = painpointDelta + micro.deltas` (capped)
6. State applied once with combinedDelta
7. Turn-metadata speichert `micro_state: { applied_signals, micro_deltas, painpoint_delta }`

## System-Prompt-Cue-Block
Wenn relevante Mikro-Signale anliegen, wird ein `[MIKRO-CUES]`-Block angehängt mit kurzen Tonal-Direktiven, z.B.:
- filler_words → "stockt sprachlich, werde ungeduldiger"
- apology_cluster → "wirke souveräner, nicht versöhnlich"
- subjunctive_cluster → "fordere klare Aussage im Indikativ"
- monologue_excessive → "unterbrich höflich aber bestimmt"
- substantive_answer → "quittieren ohne übertriebenes Lob"

Cues beeinflussen Ton, nie Inhalt.

## Debrief-Integration
- `conversation-os-debrief` liest `metadata.micro_state.applied_signals` aus User-Turns und übergibt LLM als Beweismaterial
- System-Prompt: "Nutze Mikro-Signale als BEWEISMATERIAL für dramaturgy_patterns — sie zeigen warum Eindruck atmosphärisch gekippt ist, auch ohne harten Painpoint-Hit"

## Anti-Drift / Kein Bruch
- KEINE neuen DB-Spalten (nutzt bestehende `turns.metadata` jsonb + `turns.state_delta`)
- Painpoint-Selection-Logik UNVERÄNDERT (Cooldown, max_activations, trigger_conditions)
- Cut A (Dramaturgy) + Cut B (Character-Variation) bleiben kompatibel
- BRIDGE_DONT_FORK: Atmosphärische Deltas ergänzen Painpoint-Deltas, ersetzen sie nicht

## Files
- supabase/functions/conversation-os-turn/index.ts — detectUserSignals erweitert, MICRO_DELTAS+computeMicroDeltas, combinedDelta, microCueBlock im sysPrompt
- supabase/functions/conversation-os-debrief/index.ts — Mikro-Signale im User-Prompt, System-Prompt-Hinweis

## Next
Cut D — Mastery & Progression UI (Trend per Dimension, Best-Run-Comparison, Skill-Unlocks auf History-Page).
