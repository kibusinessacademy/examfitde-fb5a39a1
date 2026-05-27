---
name: ConversationOS Phase 2 Cut B — Character-Variation pro Painpoint
description: Same painpoint, different character → echte Replayability via scenarios.painpoint_overrides Merge
type: feature
---
# Cut B — Character-Variation pro Painpoint (2026-05-27)

## Problem
Painpoint-Graph war global: `vague_answer` löste bei Caroline Fechner (Compliance) und Werner Mittag (Betriebsrat) identische Reaktion aus. Keine Replayability — Lernende konnten Charaktere nicht unterscheidbar erfahren.

## SSOT
- `conversation_os_painpoint_graphs.character_reaction` bleibt **generischer Fallback**
- `conversation_os_scenarios.painpoint_overrides jsonb DEFAULT '{}'` (NEU) = per-Charakter Override-Map
  - Key: `painpoint_key` (z.B. `vague_answer`)
  - Value: `{ tone_shift, pressure_level, tactic, line_template, state_deltas? }` — alle Felder optional, werden ge-merged
- `conversation_os_turns.character_variant_applied boolean` (NEU) — Audit, ob Override für diesen Turn gefeuert hat

## Runtime-Merge (conversation-os-turn)
```
mergedReaction = { ...selectedPp.character_reaction, ...scenario.painpoint_overrides[key] }
stateDelta     = { ...selectedPp.state_deltas, ...override.state_deltas }
```
Turn-Insert speichert `character_variant_applied + metadata.character_variant`. System-Prompt zeigt `[AKTIVER PAINPOINT: <key> · CHARAKTER-VARIANTE]` wenn Override fired.

## Debrief-Sichtbarkeit
- `conversation-os-debrief` lädt `character_variant_applied + metadata`, zählt Varianten, übergibt LLM:
  - Charakter-Name (Caroline / Werner / Marc / Petra)
  - `variant_painpoints[]` mit `metadata.character_variant`
- System-Prompt: "Wenn als Charakter-Variante markiert, beschreibe WIE <name> im Gegensatz zu anderen Charakteren reagiert hat"
- Response liefert `character_variant_meta: { character_name, variants_used, variant_painpoints[] }`
- UI: Badge in "Warum hat das Gespräch eskaliert?" Card-Header — "Nx charakter-spezifisch · <Name>"

## Seed Wave 1 (4 HR-Charaktere × 2 Painpoints)
- `hr_compliance_audit_interview` (Dr. Caroline Fechner) — `vague_answer` (juristisch-präzise), `trust_collapse` (amtlich-formal)
- `hr_works_council_challenges_process` (Werner Mittag) — `vague_answer` (väterlich-belehrend), `skepticism` (laut-frontal)
- `hr_evasive_candidate` (Marc Hofmann) — `deflection` (glatt-charmant), `vague_answer` (wortreich-abstrakt)
- `hr_termination_emotional` (Petra Lange) — `defensive_employee` (emotional-tränennah), `empathy_gap` (verletzt-leise)

## Files
- supabase/migrations/<cut-b>.sql — ALTER ADD COLUMN scenarios.painpoint_overrides + turns.character_variant_applied
- supabase/functions/conversation-os-turn/index.ts — merge-block §3
- supabase/functions/conversation-os-debrief/index.ts — variant-aware prompt + character_variant_meta response
- src/pages/os/ConversationOSDebriefPage.tsx — variantMeta state + Badge im Dramaturgy-Header

## Next
Cut C — Realismus-Boost State Engine (Mikro-State-Cues, erweiterte linguistic markers).
