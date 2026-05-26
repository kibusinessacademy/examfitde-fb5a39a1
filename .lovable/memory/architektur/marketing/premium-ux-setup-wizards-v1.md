---
name: Premium UX One-Click Setup Wizards v1
description: SSOT-Layer für alle Enterprise-Integrationen — `enterprise_setup_wizard_state` + 2 RPCs + Catalog + WizardRunner + Hub auf /admin/setup-wizards. Bridges existierende SSO/SCIM/Bulk-Import statt Neubau.
type: feature
---

# Premium UX — One-Click Setup Wizards v1 (2026-05-26)

## Ziel
Plattform-Premium-UX: "Der Kunde muss nichts mehr verstehen, konfigurieren oder zusammensuchen."
Unified Hub für alle Enterprise-Integrationen — drives Aktivierung, Lock-in und Zahlungsbereitschaft.

## SSOT (DB)
- `public.enterprise_setup_wizard_state` (UNIQUE org_id + wizard_key) — Status + current_step + config + completed_at.
- `public.enterprise_setup_wizard_events` — Audit jeder Transition.
- Enum `setup_wizard_status` = not_started | in_progress | connected | error | skipped.
- RLS: nur `fn_is_org_manager(org_id)` oder admin lesen; Writes nur via RPC.

## RPCs (SECURITY DEFINER, has_role/manager-gated)
- `setup_wizard_list_for_org(_org_id)` → `{reason, states[]}`.
- `setup_wizard_upsert_state(_org_id, _wizard_key, _status, _current_step, _total_steps, _config, _last_error)` — schreibt State + Event + best-effort `fn_emit_audit('setup_wizard_state_change',…)`.
- Audit-Contract `setup_wizard_state_change` registriert (owner_module=`premium_ux_setup_wizards`).

## Code-SSOT (Catalog)
- `src/lib/setup-wizards/catalog.ts` — `WIZARDS[]` mit Kategorien identity/workspace/hr/lms/crm/devtools/ai_provider/billing/analytics/webinar/knowledge.
- Bridge-Pattern: Wizard mit `existing_route` → deep-links zu SSO/SCIM/Bulk-Import (kein Neubau). Mit `connector_id` → Lovable-Connector-Hinweis. Sonst `steps[]` für inline Runner.
- 17 Wizards initial: SSO, SCIM, CSV-Import, Personio, Slack, Teams, Outlook, LTI 1.3, HubSpot, GitHub, Linear, Lovable AI Gateway, Stripe, GA4+GTM, Search Console, Zoom, Notion, Google Drive.

## UI
- `src/pages/admin/SetupWizardsPage.tsx` — Hub Route `/admin/setup-wizards`. KPI (connected/total), Tabs pro Kategorie, Karten mit Status-Badge, Modal-Overlay für WizardRunner.
- `src/components/setup-wizards/WizardRunner.tsx` — Generic Runner: Progress, Felder, persist-on-step, Bridge-Panel für existing_route/connector.
- `src/hooks/useSetupWizards.ts` — React-Query Hooks (list + upsert mit invalidate).
- IntegrationHub (Leitstelle) verlinkt sichtbar zum Wizards-Hub — kein doppelter UX-Pfad.

## Prinzipien
- SSOT_FIRST: keine parallele Integrations-Registry, keine zweite Status-Tabelle.
- BRIDGE_DONT_FORK: bestehende SSOWizard/SCIM/API-Keys/Bulk-Import bleiben unangetastet — Hub linkt nur.
- AUDITABLE_MUTATIONS: jede Transition über `fn_emit_audit` + `enterprise_setup_wizard_events`.
- SECURITY_INHERITS: `fn_is_org_manager` Gate identisch zu Copilot/Cross-Org/Automation.

## Nicht in Scope (Cut 2)
- Tatsächliche OAuth-Token-Speicherung (heute symbolisch via `config`). Wenn Provider verbunden wird, läuft das parallel über Lovable-Connectors / dedizierte Edge-Functions.
- Per-Wizard E2E-Smoke. Audit-Logs reichen für Cut 1.
- Quality-Health-Score / Time-to-Activation Reports — sinnvolles Cut-2 Thema sobald >5 Orgs aktiv sind.
