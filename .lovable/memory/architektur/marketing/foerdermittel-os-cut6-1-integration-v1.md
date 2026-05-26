---
name: FördermittelOS Cut 6.1 — Integration Completion
description: Routes registriert, FundingReportCta auf Hub/Cluster/Program eingebunden, WissensOS-Bridge im CopilotPanel klickbar, Reporting in Admin-Nav verlinkt, Lead-Capture E2E-Smoke (guard-skippable)
type: feature
---

# Cut 6.1 — Integration Completion (keine neue Fachlogik)

## Routes (src/routes/AppRoutes.tsx)
- `/foerdermittel/report/:reportKey` → FoerdermittelReportPage (lazy)
- `/foerdermittel/reporting` → FoerdermittelReportingPage (lazy)

## CTA-Einbindung (FundingReportCta)
- Hub `/foerdermittel`: variant=primary, matches+profile durchgereicht
- ClusterPage (state/topic/industry/combination/checklist/current): variant=compact, leadSource via Map cluster.meta.kind → LeadSourcePage (`size`→`hub` fallback)
- Programmseite `/foerdermittel/programm/:slug`: variant=compact, source=program_detail (vor CopilotPanel)
- TopicPage (`/foerdermittel/thema/:topic`) bewusst nicht angefasst (eigenes Layout, separat in Cut 7 angehen)

## CopilotPanel WissensOS-Bridge
- Bridge mit intent `save_knowledge_note_in_wissens_os` ist jetzt `<button>` mit onClick
- Schreibt `conversion_events.cross_os_recommendation_clicked` (module=foerdermittel, target_os=WissensOS) und persistiert Pending-Note in `localStorage('wissensos.notes.pending')` (max 50 Einträge)
- Bridge-don't-fork: kein WissensOS-Write erzwungen, Label "vorbereitet · klick"

## Admin-Verlinkung
- AdminV2Shell SECONDARY_ITEMS um Eintrag „FördermittelOS Reporting" → `/foerdermittel/reporting` ergänzt (Reporting selbst bleibt admin-gegated via useAuth.isAdmin)

## E2E-Smoke
- `scripts/foerdermittel-lead-capture-smoke.mjs`
- Guard-Skip wenn SUPABASE_URL/ANON_KEY fehlen (exit 0)
- 3 Fälle: invalid_email→400, no_consent→400, happy_path→200 (429/402 → soft-pass)
- URL-PII-Check (keine PII im Endpoint-Pfad)
- E-Mail-Domain `@examfit-smoke.local` (bestehende Test-Fixture-Konvention, Test-Account-Exclusion in L3)

## Bestätigt nicht angetastet
- conversion.ts / SSOT-Funktionen
- foerdermittel-lead-capture edge function
- bestehende 99/99 Tests
