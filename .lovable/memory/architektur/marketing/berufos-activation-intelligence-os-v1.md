---
name: BerufOS Activation & Intelligence OS v1
description: Zentraler Hub /admin/activation-os — Smart Recommendations Engine (deterministic, evidence-based) + Activation Timeline + Integration Health Center auf bestehenden admin_*-RPCs (kein neuer DB-Layer, BRIDGE_DONT_FORK zu Wizards/Heal/Copilot/Graph).
type: feature
---

# BerufOS Activation & Intelligence OS v1 (2026-05-26)

## Ziel
Zentrale Steuerzentrale für die 7 Layer der Plattform (Activation · Learning-Ops · AI-Ops · Content-Ops · Growth · Recovery · Enterprise). Erkennt automatisch fehlende Aktivierungen, Risiken und Chancen — ohne neue Fundament-Schicht.

## SSOT (Code, kein DB-Layer)
- `src/lib/setup/recommendations.ts` — Pure deterministic engine. Recommendation-Contract (id, category, severity, impact_score, effort_score, evidence, deep_link, auto_fix_available). Thresholds nur, keine AI.
- `src/lib/setup/signals.ts` — `collectSignals(orgId)` aggregiert 10 bestehende `admin_*`/setup_wizard-RPCs (customer_safe, data_holes, commerce_gap, empty_published_courses, content_sellability, berufos_graph, heal_alerts, ai_observability, lane_health, wizard_state). Graceful-degrade pro RPC bei Unauthorized.
- `src/hooks/useSetupRecommendations.ts` — TanStack-Query Wrapper (staleTime 60s, refetch 2min).

## UI
- `src/pages/admin/ActivationOSPage.tsx` — Route `/admin/activation-os`. Org-Picker (Manager-Membership), Layer-Karten verlinken in bestehende Tools.
- `src/components/setup/SmartRecommendationsCard.tsx` — sortiert critical>warn>info, dann impact desc. Pflicht-Props der Leitstellen-Convention erfüllt (Severity/Root-Cause/Action/Audit-Quelle/Deep-Link).
- `src/components/setup/ActivationTimelineCard.tsx` — Phasen Lernplattform/Curriculum/Growth/Governance, abgeleitet aus denselben Signalen.
- `src/components/setup/IntegrationHealthCenterCard.tsx` — pro Area AI/Commerce/Content/Infrastructure/Activation, Status ok/warn/crit/unknown.

## Prinzipien
- SSOT_FIRST · NO_PARALLEL_SYSTEMS: keine eigene Tabelle, keine eigene RPC — nur Aggregation.
- BRIDGE_DONT_FORK: alle Deep-Links zeigen auf existierende Tools (`/admin/setup-wizards`, `/admin/heal`, `/admin/growth`, `/berufs-ki/*`).
- FAIL_VISIBLE: jede Empfehlung trägt Quelle + Count + Deep-Link.
- AUDITABLE_MUTATIONS: Engine ist read-only — keine Writes, keine Audit-Contracts nötig.
- SECURITY_INHERITS: alle Signal-RPCs sind bereits has_role-gated; UI zeigt unknown bei fehlendem Zugriff.

## Empfehlungs-Kategorien (initial 10 Regeln)
- Activation: wizard.errors, wizard.low_activation, wizard.missing.{sso_saml_oidc|stripe_billing|lovable_ai_gateway|ga4_gtm}
- Learning: learning.not_customer_safe
- Curriculum: curriculum.data_holes, curriculum.empty_published
- Growth: growth.no_price (CRIT), growth.no_landing
- Governance: governance.heal_alerts, governance.stuck_jobs
- AI: ai.tutor_no_evidence, ai.graph_sparse

## Nicht in Scope (Cut 2 — bewusst weggelassen)
- D. Multi-Rollout Wizard, F. AI Setup Concierge, Auto-Fix-Trigger als Buttons (Engine markiert nur, Heilung läuft weiterhin in bestehenden Tools/Crons).
- Persistierte Recommendation-History oder Snoozing — sinnvoll wenn >5 Orgs aktiv sind.
- Distribution Engine, Workflow Marketplace, Predictive Layer — explizit User-Strategie "Adoption vor neuer Komplexität".

## Verdrahtung verifiziert
- Route hinzugefügt zu `src/routes/AppRoutes.tsx` (Lazy-Import + Public-Route, da bereits hinter Admin-Auth via has_role-Gates der RPCs).
- IntegrationHub-Karten verlinken weiterhin zu `/admin/setup-wizards`; OS-Page bietet zusätzlich Layer-Navigation.
