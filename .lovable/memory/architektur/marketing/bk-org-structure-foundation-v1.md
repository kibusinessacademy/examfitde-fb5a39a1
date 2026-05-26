---
name: BK-Act-5.1 Org Structure Foundation
description: SSOT tables (sites/departments/cohorts/reporting_units) + scoped assignments + scope helpers for Enterprise BI
type: feature
---

# BK-Act-5.1 — Organisations-Struktur-Fundament

Enterprise-Substrat unter `org_memberships`. Erweitert die Datenebene um:

- `org_sites` — Standorte (site_key UNIQUE pro org)
- `org_departments` — Fachbereiche, optional unter Standort, mit parent
- `org_cohorts` — Ausbildungsjahrgänge / Prüfungswellen (profession_key, start_year, exam_window, training_year, risk_band, recovery_band)
- `org_reporting_units` — logische Reporting-Klammer (site/department/cohort/profession/custom)
- `org_member_assignments` — User × {site|department|cohort|reporting_unit} × scoped_role (`learner | ausbilder | standortleiter | bereichsleiter | hr | executive | manager_readonly`), `is_primary`, Gültigkeitsfenster

## Helper

- `fn_has_org_management(_user,_org)` — owner/admin/manager Gate (SECURITY DEFINER)
- `fn_org_user_scope(_user,_org)` jsonb — `has_full_org_scope` für owner/admin, sonst aggregierte Scopes aus `org_member_assignments`
- `fn_can_view_site(_user,_site)` — Convenience für Site-Sichtbarkeit

## Manager-RPCs

- `org_structure_list(_org_id)` — sites+departments+cohorts+reporting_units + caller scope
- `org_site_upsert / org_cohort_upsert / org_member_assignment_upsert`
- Alle drei emittieren `fn_emit_audit` mit `org_site_upserted | org_cohort_upserted | org_member_assignment_created`

## RLS

- read: aktive Org-Member (`is_org_member`)
- write: nur owner/admin/manager über `fn_has_org_management`
- `org_member_assignments`: user_id = auth.uid() darf eigene Zuweisungen lesen

## UI

- Route `/org/structure` — `OrgStructurePage` mit `OrgConsoleShell` Picker; Standorte- & Kohorten-Anlage
- Hooks: `useOrgStructure`, `useUpsertSite`, `useUpsertCohort`, `useAssignMember`
- SSOT Client: `src/lib/berufs-ki/orgStructure.ts`

## Anti-Drift

- Org-Rollen-Konstrument-Check auf `org_memberships` bleibt unverändert (nur owner/admin/manager/learner). Neue Rollen leben ausschließlich auf `org_member_assignments.scoped_role`.
- Keine direkten Mutationen — alle Writes über RPCs mit Audit.

## Nächste Schritte

- BK-Act-5.2: Cross-Org Intelligence (Standortvergleich, Risk Heatmap je Fachbereich, Recovery je Cohort) auf den neuen Scopes
- BK-Act-5.3: Executive Narrative
- BK-Act-5.4: Enterprise Reporting
