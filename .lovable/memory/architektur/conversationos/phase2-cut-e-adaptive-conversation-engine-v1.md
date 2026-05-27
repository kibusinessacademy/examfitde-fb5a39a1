---
name: ConversationOS Phase 2 Cut E — Adaptive Conversation Engine
description: Hidden States + Phase + Momentum + Difficulty + Drift + Drill + Contradiction Memory + Adaptive Outcome. Keine Migration — alles in jsonb metadata.
type: feature
---
# Cut E — Adaptive Conversation Engine (2026-05-27)

## Ziel
Gespräch fühlt sich lebendig an statt linear Q&A. Recruiter verändert sich durch den Kandidaten (Drift, Skepsis, Pressure, Interest, Fatigue), eskaliert adaptiv (Difficulty), bohrt nach (Drill-Chain), erkennt Widersprüche (Contradiction Memory), und das Debrief liefert ehrliches Outcome-Label.

## SSOT
Kein Schema-Change. Alles in:
- `conversation_os_sessions.metadata.adaptive` (AdaptiveMeta, perf_history)
- `conversation_os_turns.metadata.adaptive` (per-turn snapshot)
- `conversation_os_debriefs.metadata` (adaptive_outcome, recruiter_journey, contradictions_addressed, adaptive_final)

## Komponenten in `conversation-os-turn`
1. **Hidden Adaptive State** — skepticism, pressure, interest, fatigue, performance_score (0..1, EMA evolved per Turn aus Signals + Perf).
2. **Contradiction Memory** — `CLAIM_AXES` (Teamarbeit, Stabilität, Führung, Detail, Risiko, Kommunikation). `extractClaim` + `detectContradiction` → Signal `contradiction_detected` + Confrontation-Block im sysPrompt.
3. **Performance Score** — `scoreUserTurn(signals)` → rollende perf_history (max 12), `momentum` ∈ {strong, neutral, weak}.
4. **Multi-Phase** — `derivePhase`: warmup (0–3), evaluation (4–8), stress (≥9 oder pressure>0.55 / skepticism>0.6), decision (≥16 oder skepticism>0.8 / fatigue>0.7 / interest<0.15). Kein Rückfall.
5. **Adaptive Difficulty** — easy / standard / hard / edge_case aus Phase × Momentum × Skepsis.
6. **Character Drift** — neutral / respectful / curious / skeptical / aggressive / disengaged aus Hidden-States + Momentum. Inject als Tonalitäts-Direktive.
7. **Drill-Chain** — Wenn letzte Assistant-Frage probing (`warum/wieso/konkret/?`) und User schwach (vague/topic_drift/hedging/wordcount_low) → drill_chain.depth++ am gleichen Topic-Anchor. Substantive Antwort → reset. Inject `FOLLOW-UP ATTACK` Block, blockt Themenwechsel.
8. **Outcome Live** — `deriveOutcome` pro Turn als Vorab-Label (recruiter_uncertain / high_potential_but_risky / technically_strong_socially_weak / confident_but_vague / rejected_due_to_inconsistency / promising_under_pressure / recruiter_disengaged / strong_overall / weak_overall).

## Komponenten in `conversation-os-debrief`
- Adaptive-Kontext (Endzustand + Widerspruchspaare) zusätzlich an LLM.
- Tool-Schema erweitert: `adaptive_outcome` (enum), `adaptive_outcome_rationale`, `recruiter_journey`, `contradictions_addressed[]` (alle required außer contradictions).
- Persist in `debriefs.metadata`.

## Response-Header (Client kann Realtime-UI andocken — UI-Erweiterung folgt)
`x-conv-phase`, `x-conv-difficulty`, `x-conv-drift`, `x-conv-momentum`, `x-conv-outcome-live`, `x-conv-contradiction`

## Anti-Drift
- KEINE neuen DB-Spalten, KEINE Migration.
- Cuts A/B/C/D bleiben funktional unverändert; Adaptive-Block ist additiv zum sysPrompt.
- Painpoint-Engine + Quality-Gate unverändert.
- Kein Zertifikat-Pfad (bewusst Cut F+).

## Files
- supabase/functions/conversation-os-turn/index.ts — Cut-E-Helpers + Pipeline-Integration + Header
- supabase/functions/conversation-os-debrief/index.ts — adaptiveContext, Tool-Schema, metadata-Persist, response adaptive_meta

## Next (Cut F Kandidaten)
- Voice-native Interview (Stimme reagiert auf hidden-states: stability/style)
- Silence-Pressure (Schweige-Druck nach 8s)
- Adaptive UI: Phase-Strip + Drift-Badge + Outcome-Live-Preview im Run-Header
- Multi-Interviewer Panel (Cut G)
