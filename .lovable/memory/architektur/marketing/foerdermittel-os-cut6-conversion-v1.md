---
name: FördermittelOS Cut 6 — Conversion & Lead Capture OS
description: Lead Capture SSOT + Funding Report + Cross-OS Upsell + Cut-5 Reporting/Bridge follow-ups. Reuses b2b_leads + conversion_events. Personal reports noindex.
type: feature
---

# Cut 6 — Conversion & Lead Capture OS

## SSOT
- `src/lib/foerdermittel/conversion.ts` — pure functions: `buildLeadMagnetOffer`, `computeLeadQualityScore` (0..100 + tier cold/warm/hot), `buildFundingReportSummary`, `classifyConversionIntent`, `buildCrossOsUpsellRecommendations`, `sanitizeLeadPayload` (PII strip, free-email warning), `buildConsentCopy`, `buildReportKey` (opaque), `buildReportPath`.
- Lead intent types: funding_check_started/completed, report_requested/downloaded, copilot_action_clicked, application_roadmap_opened, cross_os_upsell_clicked.

## Storage — reuses existing SSOT (NO new tables)
- `b2b_leads` (service_role only) via edge `foerdermittel-lead-capture`. `source='foerdermittel:<page>'`, `tags=['foerdermittel', <source>, <tier>]`, `meta` carries module/request_id/quality_score/report_top_slugs/consent_at.
- `conversion_events` — `funding_report_requested` (from edge), `funding_report_generated` (from report page), `cross_os_recommendation_clicked`.
- Idempotency: per-email duplicate skip if same `request_id` or any prior `module=foerdermittel` lead exists.

## UI
- `FundingReportCta` (variants: primary | compact | inline) — Hub (primary), Cluster (compact), Program (inline next to roadmap).
- `LeadCaptureDialog` — 3-step progressive (Profile → Goal → Email+Consent), business-email hint (non-blocking), inline DSGVO Art. 6 Abs. 1 lit. a copy.
- `FundingReportPreview` + `CrossOsUpsellList` — deterministic report rendering.
- `/foerdermittel/report/:reportKey` — personal report page, hard-noindex via Helmet + opaque URL key (no PII).

## Cut-5 follow-ups (in same loop)
- `/foerdermittel/reporting` — admin-gated (useAuth.isAdmin) cross-module measurement view: cluster inventory, thin/indexable split, Ø authority score, freshness distribution, 30-day conversion-event aggregation. noindex.
- `CopilotPanel` — added "Als WissensOS-Notiz speichern" button per prepared bridge intent: writes `conversion_events.cross_os_recommendation_clicked` and persists to `localStorage('wissensos.notes.pending')` (no WissensOS module yet — bridge-don't-fork).

## SEO Discipline
- Personal report pages: Helmet `noindex,nofollow,noarchive,nosnippet`.
- Opaque report keys (`r_<base36ts>_<6hash>`) — never contain email/company.
- CTA cards on indexable pages stay indexable.
- No new thin cluster surfaces.

## Tests
- `src/test/foerdermittel/conversion.test.ts` — 18 tests covering: lead magnet offer (empty + urgent), lead quality score (range, tier monotonicity), intent classifier (all 7 intents + unknown), report summary (matches, ISO date, cross-os list, empty-warnings), cross-os recommendations (WissensOS always, ComplianceOS=now when blocked), consent copy (DSGVO Art. 6), payload sanitization (invalid email / missing consent / phone-PII strip / non-business warning), URL safety (opaque keys never contain email/company, path validation), regression (PROGRAMS + matchPrograms still callable).
- Full FördermittelOS suite expected: 89/89 (Cut 1–5: 71 + Cut 6: 18).

## Bridge to Cut 7
- Sales-Inbox + Follow-up Pipeline will read `b2b_leads where tags @> '{foerdermittel}'` and segment by `meta->>'lead_tier'`. No schema change needed.
