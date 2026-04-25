---
name: CRM Deals Drilldown + Auto-Preselect/Live-Job-Status + Marketing Audit Export
description: Drilldown-Drawer pro Deal (Orders/Activities/Sequences mit Fix-CTA), Auto-Preselect aller eligible Pakete in StaleMarkerDiffPage mit Live job_queue Polling (5s) für tracked package_ids, PDF+Excel SEO/Marketing/CRM E2E Audit.
type: feature
---

## CRM Deals Drilldown
- `src/components/admin/marketing/CrmDealsDrilldown.tsx` — Liste + Sheet-Drawer
- Pro Deal: Kontakt (crm_contacts), Orders (via product_ids ↔ order_items.license_package_id), Activities (deal_id), Email-Sequences (audience ↔ lifecycle_stage)
- Jede Lücke (kein Kontakt/Order/Activity/Sequence) zeigt GapAlert mit Fix-CTA-Link
- Eingebunden in MarketingIntelligencePanel zwischen CRM-Section und Email-Section

## StaleMarkerDiffPage Auto-Preselect + Live-Status
- Switch "Auto-Preselect (N)" oben in Controls — re-syncs Selektion bei jeder Filter-/Daten-Änderung
- Live Job-Status Card erscheint sobald ≥1 Paket gepurged wurde
- Polling alle 5s gegen job_queue (filter: package_id IN trackedIds, created_at >= now()-1h)
- PurgeExhaustionButton hat neuen `onPurged` Callback → Parent kann Tracking befüllen
- Single-Row-Purge UND Bulk-Purge füllen beide trackedIds (max 50)

## Audit-Export
- `/mnt/documents/marketing-audit-2026-04-25.pdf` — 5 Seiten Executive Summary
- `/mnt/documents/marketing-audit-2026-04-25.xlsx` — 5 Sheets (Heatmap, Gaps&Fixes, Opportunities, Raw KPIs, Top5)
- Generator: `/tmp/audit_gen.py` (psql read-only, reportlab+openpyxl)
- Diagnose: 4/5 Funnel-Stages CRITICAL (Acquisition/Activation/Revenue/Retention), nur Awareness ok
