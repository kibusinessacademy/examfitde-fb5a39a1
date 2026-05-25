---
name: Founder Agents v1
description: 5 read-only Admin-Agenten (Launch Forecast, Founder Copilot, Build Strategy, Revenue Readiness, AI Capability) in einem Edge-Function + einer Admin-Page. Deterministische Signal-Sammlung + Lovable AI Gateway für Narrative.
type: feature
---

# Founder Agents v1

Persönliche Admin-Beratungsschicht für strategische Entscheidungen. Read-only — keine Mutationen, keine neuen Tabellen, keine neuen Queues.

## Architektur

- **Edge Function** `admin-founder-agents` (action-based): liest deterministisch 20 Signale aus DB (products, prices, packages, customer_safe-View, conversion_events, jobs, leads, emails, ai_tutor_audit, heal_alerts) und synthetisiert Narrative via Lovable AI Gateway (`google/gemini-3-flash-preview`, temp 0.3, max 5 Bullets).
- **Page** `/admin/founder-agents` (`FounderAgentsPage.tsx`): 5-Tab UI (Forecast · Copilot · Strategy · Revenue · AI-Cap). Markdown-Render via `react-markdown`.
- **Admin-Gate**: identisch zu `admin-auth-email-smoke-test` (user JWT → has_role('admin')).
- **Nav**: zweiter Eintrag in `AdminV2Shell.NAV_ITEMS`.

## Die 5 Agenten

| Agent | Signal-basiert | AI-Synthese |
|---|---|---|
| **launch_forecast** | 7 Risiko-Heuristiken (kein Pricing, keine Käufe, Pipeline-Failure-Rate, Customer-Safe<60%, Lead/SEO-Lücke, AI ohne Nutzung, Heal-Alerts) → overall green/amber/red + sortierte Risiken mit Probability+Evidence | Top-3 Risiken + Hebel |
| **founder_copilot** | Reiner Context-Pass | Frei formulierte Founder-Frage; Fallback: "wichtigster Hebel diese Woche" |
| **build_strategy** | Score-Matrix über 6 Strategies (SEO/AI/Premium/Enterprise/Mobile/Automation-first) | 90-Tage-Roadmap-Meilensteine |
| **revenue_readiness** | 9-Punkt-Scorecard (Stripe/Pricing/Checkout/Leads/Events/Email/SEO/Conversion-Rate/Customer-Safe) → 0–100 Score | Top-3 Revenue-Blocker |
| **ai_capability** | 8-Modul-Inventur (Chat/Search/NBA/Voice/OCR/Workflows/Memory/Automations) → Gaps + governance_level | Höchster ROI vs Overengineered |

## Reuse-Inventar

- Reused: `v_package_customer_safe_v1`, `conversion_events`, `job_queue`, `leads`, `email_delivery_queue`, `ai_tutor_audit`, `heal_alert_notifications`, `has_role()`.
- Pattern reused: `admin-auth-email-smoke-test` (Admin-Gate, CORS, error envelope).
- AI-Aufruf reused: Lovable AI Gateway `https://ai.gateway.lovable.dev/v1/chat/completions` (kein neuer Provider).

## Architectural Continuity Check

- ✅ SSOT_FIRST — alle Signale aus existierenden SSOTs
- ✅ EXTEND_EXISTING — Admin-Shell-Nav erweitert, nicht geforkt
- ✅ NO_PARALLEL_SYSTEMS — eine Edge-Function für 5 Agenten
- ✅ NO_AUTONOMOUS_PRODUCTION_WRITES — read-only
- ✅ FAIL_VISIBLE — leere AI-Antwort wird als amber-Hinweis sichtbar gemacht
- ✅ NO_HIDDEN_STATE — Rohdaten via `<details>` einblendbar

## Erweiterungs-Hooks (optional, v2)

- `signals.counts` als Snapshot in `auto_heal_log` action_type=`founder_agent_signal_snapshot` (würde Audit-Contract brauchen)
- Trend-Modus: 7d-Delta pro Signal
- Copilot Multi-Turn (conversation_id, persistente History)
