---
name: Berufs-KI Dokumenten-Agent Phase 1+2+3
description: Foundation (Templates/Branding/Compliance) + Export-Engine (PDF/DOCX) + Review/Approval-Workflow mit Export-Guard für High-Risk.
type: feature
---

## Phase 1 — Foundation
- Tabellen: `document_agent_profiles`, `document_agent_templates`, `document_agent_runs`.
- Edge `berufs-ki-document-run` mit Profession-Guard + Compliance-Heuristik.
- 10 Seed-Templates.

## Phase 2 — Premium Export
- `document_agent_exports` SSOT + privater Bucket `document-exports`.
- Edge `berufs-ki-document-export` (PDF via pdf-lib, DOCX via docx@8.5.0). Branding-Injection, ENTWURF-Banner bei review_required.

## Phase 3 — Review & Approval
- Neue Tabellen: `document_agent_reviews` (status: pending|approved|rejected|needs_changes|cancelled, risk_level, compliance_flags) + `document_agent_review_comments` (severity info|warning|critical, section_key).
- Run-Status erweitert um `rejected`.
- 5 RPCs (SECURITY DEFINER, authenticated):
  - `doc_agent_request_review(run_id, notes)` — setzt run.status='needs_review', erstellt Review.
  - `doc_agent_submit_decision(review_id, decision, notes)` — approved|rejected|needs_changes. Self-Approval bei high_risk verboten.
  - `doc_agent_add_review_comment(review_id, comment, section_key, severity)`.
  - `doc_agent_list_reviews(status, limit)` — Inbox (sortiert pending→needs_changes→rest).
  - `doc_agent_get_review(review_id)` — full payload mit run, template, comments.
- **Export-Guard** (Trigger `trg_guard_doc_export_requires_approval` BEFORE INSERT auf `document_agent_exports`): blockt INSERT wenn `template.risk_level='high'` und `run.status NOT IN ('approved','exported')`. Hard-Gate.
- RLS: Eigentümer/Reviewer/Org-Members/Plattform-Admin SELECT; INSERT/UPDATE nur via Definer-RPCs.
- UI: `/berufs-ki/dokumente/review` (`BerufsKIDocumentsReviewPage.tsx`) — 3-Spalten (Pending-Liste · Dokument-Vorschau · Review-Panel), KPI-Strip (pending/needs_changes/approved/rejected/high_risk), Tabs-Filter, Compliance-Banner, High-Risk-Hint, Kommentar-Thread mit Severity-Badges.
- Studio (`BerufsKIDocumentsPage`): „Review-Inbox"-Link im Header + „Zur Freigabe einreichen"-Button im Result.

## Invarianten
- Nie „rechtssicher" garantieren — Disclaimer-Pflicht.
- High-Risk + nicht approved ⇒ Export-Trigger blockt INSERT → kein PDF/DOCX möglich.
- Self-Approval bei high_risk verboten (außer Plattform-Admin).
- Reviews und Kommentare sind audit-fähig (UUID, created_by, timestamps).

## Offen (Phase 4+)
- Side-by-Side Versions-Diff · Multi-Reviewer-Policies · KI-Review-Heatmap (riskante Passagen) · Stripe Export-Limits · Logo-Embed.
