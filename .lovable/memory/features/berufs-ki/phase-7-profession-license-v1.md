---
name: Phase 7 Global Profession License & Agent Logic
description: Berufsfeld-gebundene Lizenz-, Agenten- und Kompetenz-Infrastruktur. Fail-closed Guard, profession_contexts SSOT, primary-license enforcement, agent access per Org.
type: feature
---

## Tabellen
- `profession_contexts` (SSOT pro Berufsfeld: erlaubte Agenten/Kategorien/Workflows + governance/risk/branding/escalation)
- `organization_profession_licenses` (UNIQUE org+profession, partial-unique `is_primary AND status='active'`, tier+source+expires_at, switch_cooldown)
- `organization_agent_access` (Org→Agent Override, enabled+tier_required)
- `profession_guard_events` (Audit jeder allow/deny mit reason)

## RPCs
- `check_profession_agent_access(_org,_agent_slug,_workflow_slug,_profession_id,_required_tier) → jsonb {allowed,reason,profession_id,tier,agent_id}` — fail-closed; loggt jeden Call
- `get_organization_profession_access(_org)` → licenses + agents + primary_context
- `admin_grant_profession_license(...)` — UPSERT, setzt is_primary atomar
- `admin_set_agent_access(...)`, `admin_upsert_profession_context(...)`

## Deny-Reasons
agent_unknown · profession_missing · tier_insufficient · agent_not_in_profession_context · agent_category_blocked · agent_disabled_for_org · agent_tier_insufficient

## Edge-Function-Bridge
`berufs-ki-agent-run` ruft Guard wenn `organization_id` im Body → 403 `profession_guard_denied` mit reason. Ohne org_id = legacy unrestricted (Admin/Test).

## Client
- `src/lib/profession-license/api.ts` — typed RPCs + GUARD_REASON_LABEL
- `useProfessionAccess(orgId)` + `useAgentEnabled(access, slug)`
- `<ProfessionLockBadge>` — SSOT-UI für gesperrte Bereiche

## Invarianten
- Primary-Lizenz pro Org genau 1 (partial unique).
- Switch nur via Admin (cooldown-Feld vorbereitet, noch nicht enforced).
- Tier-Ordnung standard < pro < enterprise.
- Tarif `enterprise` deckt `pro` deckt `standard`.

## Phase 7b (live)
- Cooldown-Enforcement: `admin_switch_primary_profession(_org,_new_prof,_force,_cooldown_days=30)` setzt `last_primary_switch_at`+`primary_switch_cooldown_until`, blockt non-force innerhalb Cooldown (`reason=cooldown_active`). Audit jeden Switch in `profession_guard_events(reason='primary_switch', metadata={from,to,forced})`.
- Admin-RPCs (admin|support): `admin_list_orgs_with_licenses`, `admin_list_profession_contexts`, `admin_list_profession_guard_events`.
- Seed-Contexts: fachinformatiker_systemintegration, industriekaufmann, bilanzbuchhalter (idempotent via UPSERT).
- UI `/admin/governance/profession-licenses`: Org-Liste mit Primary/Addon/Cooldown-Badges, Detail: Primary-Switch (Cooldown vs Force), Add-on-Vergabe, Agent-Toggle+Tier, Guard-Event-Feed, SSOT-Context-Grid.

## Offen (Phase 7c)
- Workflow-Scope Hard-Check (aktuell soft)
- Wiring in Dokumenten-Agent / SOP / Recruiting wenn Module existieren
- Profession-Context CRUD-Editor im Admin-UI (aktuell read-only display, Insert via API direkt)

