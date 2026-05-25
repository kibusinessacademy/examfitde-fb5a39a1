---
name: Berufs-KI Dokumenten-Agent Phase 1+2 Foundation & Export
description: Premium Dokumenten-Studio mit 10 Templates, Branding-Profilen, Compliance-Heuristik, Knowledge-Graph-Bridge. Phase 2: PDF (pdf-lib) + DOCX (docx) Export-Engine mit Branding-Injection, governed via document_agent_exports + private Storage-Bucket.
type: feature
---

## Phase 1 — Foundation
- Tabellen: `document_agent_profiles` (Branding/Org-or-User), `document_agent_templates` (SSOT-Bridge zu profession_contexts), `document_agent_runs` (versioniert, status, compliance_warnings).
- Edge `berufs-ki-document-run` mit Profession-Guard + Compliance-Heuristik (rechtssicher/garantier/haftung).
- Auto-status `needs_review` bei high-risk oder Warnings.
- 10 Seed-Templates (Anschreiben, Beschwerdeantwort, Mahnung, SOP, Checkliste, Arbeitsanweisung, Angebot, Risikoanalyse, DSGVO).

## Phase 2 — Premium Export & Branding Engine
- `document_agent_profiles` erweitert: `vat_id`, `disclaimer_text`, `layout_template` (CHECK: modern_corporate|minimal_professional|legal_style|enterprise_clean|friendly_business), `font_family`, `header_layout`, `footer_layout`.
- Neue Tabelle `document_agent_exports`: SSOT für jeden PDF/DOCX-Export. Felder: run_id, branding_profile_id, template_version, export_format (pdf|docx), layout_template, compliance_level, review_required, storage_path, byte_size, export_hash (sha256), generated_at. RLS: SELECT für Owner/Org-Admin/Plattform-Admin. INSERT nur via Edge (service_role).
- Storage-Bucket `document-exports` (privat). RLS-Policy: SELECT erlaubt nur wenn `(storage.foldername(name))[1] = auth.uid()` oder admin. Pfadschema: `<user_id>/<run_id>/<ts>-<hash10>.pdf|docx`.
- Edge `berufs-ki-document-export`:
  - Lädt Run via user-Client (RLS-Ownership), Template + Profile via service_role.
  - PDF: pdf-lib (esm.sh) — A4 90mm-Header/Footer mit Brand-Primary-Linie, Company/Website-Kopf, Footer mit Kontakt+USt-ID+Seitenzahl, Title-Block, optionaler ENTWURF-Banner (orange) bei review_required, Section-Headings in Brand-Primary, automatischer Wordwrap, Signaturblock, Disclaimer.
  - DOCX: docx@8.5.0 (esm.sh) — Header mit Brand-Linie, Footer zentriert, HEADING_1 Titel, HEADING_2 Sections, optionaler ENTWURF-Banner (gelb), Signaturblock, italic Disclaimer. M365-kompatibel.
  - Hash via SHA-256, Upload nach `document-exports/<uid>/<run_id>/...`, signedURL 60min.
  - Run-Status auf `exported` setzen wenn vorher generated/approved/needs_review.
- UI-Buttons in `BerufsKIDocumentsPage` Result-Card: "PDF" + "DOCX (M365)". Profile-Form erweitert um USt-ID, Primary-Color-Picker, Layout-Select (5 Optionen), Disclaimer-Textarea.

## Invarianten
- Nie "rechtssicher garantieren" — Disclaimer immer im Export sichtbar.
- High-Risk + review_required ⇒ ENTWURF-Banner im PDF/DOCX zwingend.
- Exports nur via Edge — `document_agent_exports` ohne INSERT-Policy für authenticated.
- Storage-Bucket privat, Pfadpräfix = user_id (kein Cross-User-Read).

## Offen (Phase 3+)
- Review-/Approval-UI · Versioning-Diff · ODT-Export · Template-CRUD-UI · Logo-Embed im PDF (Bild laden) · Stripe-Limits (Basic 50/Pro 500/Business fair-use).
