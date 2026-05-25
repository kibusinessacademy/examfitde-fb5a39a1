---
name: Berufs-KI Dokumenten-Agent Phase 1 Foundation
description: Premium Dokumenten-Studio mit Branding-Profilen, 10 Seed-Templates, Edge-Runner mit Compliance-Heuristik und Review-Workflow. Bridges zu profession_contexts + Knowledge-Graph.
type: feature
---

## Tabellen
- `document_agent_profiles` — Branding/Unternehmensdaten pro Org oder User. CHECK: organization_id OR user_id Pflicht.
- `document_agent_templates` — Vorlagen (SSOT-Bridge: profession_id, curriculum_id, competency_id, blueprint_id). Risk/Tier/Review als CHECK-Spalten.
- `document_agent_runs` — versionierte Erstellung mit status (draft|generating|generated|needs_review|approved|exported|archived|failed), compliance_warnings jsonb, audit_trail jsonb.

## RLS
- Profiles: User sieht eigene; Org-Mitglieder lesen; Owner/Admin der Org bearbeitet; Plattform-Admin überall.
- Templates: aktive lesbar für alle authenticated; CRUD nur Admin.
- Runs: Owner + Org-Owner/Admin + Plattform-Admin. INSERT nur via Edge (service_role).

## Edge `berufs-ki-document-run`
- Auth-gated, Pflichtfeld-Validation aus `required_inputs`, Template-Interpolation `{{key}}` mit Branding-Kontext, Lovable AI Gateway (default `google/gemini-2.5-flash`).
- Profession-Guard via `check_profession_agent_access(agent_slug='document_agent')` wenn `organization_id` gesetzt → 403 `profession_guard_denied`.
- Compliance-Heuristik: blockiert/warnt bei "rechtssicher"/"garantier"/"haftung", PII-Phone-Pattern wenn `check_pii=true`, high-risk Auto-Review.
- Auto-Status `needs_review` wenn `review_required` ODER `risk_level=high` ODER Warnings > 0.

## Knowledge-Graph-Bridge
Trigger `trg_bki_sync_doc_template` spiegelt jede Template als Node `node_type=document_type, source_system='document_template'`.

## Admin
- RPC `admin_doc_agent_list_templates` (SECURITY DEFINER + has_role-Gate).
- Route `/admin/berufs-ki/documents` (read-only Übersicht; CRUD = Phase 2).

## UI `/berufs-ki/dokumente`
3-Spalten-Studio: Templates (gruppiert nach Kategorie, Risk-Badge) → Branding + Inputs → Ergebnis mit Compliance-Warnings, Qualitätsscore, Disclaimer.

## Seeds (10)
Kundenanschreiben, Beschwerdeantwort, Mahnung, Meeting-Protokoll, SOP, Checkliste, Arbeitsanweisung, Angebot, Risikoanalyse, Datenschutz-Hinweis (Entwurf).

## Invarianten
- Nie "rechtssicher garantieren" — Disclaimer immer sichtbar, Heuristik warnt im AI-Output.
- High-Risk + review_required ⇒ status=needs_review (Auto).
- INSERTs auf runs nur via Edge (service_role).

## Offen (Phase 2+)
- Admin-Template-CRUD (Editor) · PDF/DOCX-Export mit Branding · Review-Approve-UI · Workflow-Integration (Dokument → Ticket/Workflow) · Template-Intelligence aus Run-Mustern.
