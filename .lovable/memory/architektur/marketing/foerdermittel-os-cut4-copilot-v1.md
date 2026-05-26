---
name: FördermittelOS Cut 4 — AI CoPilot v1
description: Grounded AI CoPilot über Lovable AI Gateway, SSOT copilot.ts, action-first UI, edge function foerdermittel-copilot, Refusal/Validation Guardrails, Cross-OS Bridge Intents
type: feature
---

# FördermittelOS Cut 4 — AI CoPilot

## SSOT
- `src/lib/foerdermittel/copilot.ts` — pure, deterministic
  - `buildCopilotContext` ⇒ aus Registry + Matching + Freshness + Execution
  - `buildAllowedCopilotActions` ⇒ Action-Whitelist abhängig vom Profil
  - `classifyCopilotIntent` (Keyword-Regex, 9 Intents)
  - `buildGroundingInstructions` (strenge Regeln + Freshness-State)
  - `sanitizeCopilotPayload` (Slug-Guard auf PROGRAMS, Message-Trim 800, Profile-Whitelist)
  - `validateCopilotResponse` (Other-Program-Mentions, Freshness/Draft-Disclaimer)
  - `buildRefusal` (6 Reasons mit Suggestion)
  - `buildPreparedBridgeIntents` ⇒ 5 Cross-OS-Targets typisiert (`create_deadline_in_fristen_os`, `check_offer_in_angebotsvergleich_os`, `check_contract_in_vertragschecker_os`, `create_policy_review_in_compliance_os`, `save_knowledge_note_in_wissens_os`) mit `availability: available|coming_soon`

## Gateway
- Edge Function: `supabase/functions/foerdermittel-copilot/index.ts`
- Model default: `google/gemini-2.5-flash`, temperature 0.2
- Hard Guards: intent allowlist, program context required, grounding ≥80 chars, PII-Detector (`/email-regex/`), 429/402 sauber an Client durchgereicht
- 3-Layer-Messages: grounding (system) + JSON-Context (system) + intent directive (system) + user

## UI
- `src/components/foerdermittel/CopilotPanel.tsx` — action-first auf Programmseite
  - kein freier Chat-Eingang
  - vordefinierte Aktionen mit Profile-Gate
  - Answer-Card mit Freshness-Badge + Quellen + Validation-Warnings
  - Stale/Unknown Alert
  - Refusal-State premium
  - Cross-OS Bridges als "vorbereitet/bald verfügbar"
- `src/components/foerdermittel/CopilotHubCta.tsx` — Hub-CTA ohne Open Chat
- Eingebunden: `FoerdermittelProgramPage` + `FoerdermittelHubPage` (`#matching` Anchor)

## Guardrails (Cut 4)
- nur Programme aus `PROGRAMS` zulässig (`isRegisteredProgramSlug`)
- keine PII im Gateway-Payload (Profile nur `{region,size,topics}`)
- Refusal bei `missing_profile`, `missing_program`, `stale_source`, `model_unavailable`
- Validator markiert fehlende Disclaimer + Erwähnung anderer Programme
- Stale/Unknown ⇒ Grounding zwingt manuelle Quellenprüfung
- Outline ⇒ ENTWURF-Disclaimer Pflicht
- Kein paralleles AI-System; keine Mock-AI

## Tests
- `src/test/foerdermittel/copilot.test.ts` — 26 Tests
- Cut 1+2+3+4 Suite: **55/55 grün** (freshness 14 + execution 15 + copilot 26)

## SEO
- Premium Static Sections im Panel (kein indexierbarer AI-Chat-Output)
- CopilotHubCta zeigt Schlüssel-Keywords „Förderantrag vorbereiten mit KI", „Unterlagencheck", „Matching mit Aktualitätsprüfung"

## Folge-Cut
- Cut 5: SEO Authority Engine (Bundesland-/Themen-/Branchen-/Kombi-Cluster)
