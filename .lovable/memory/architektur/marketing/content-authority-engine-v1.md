---
name: Content Authority Engine v1
description: SSOT /authority/* — Topic-Hubs + Tools + Checklisten + Vorlagen + Risiko-Checks + (geplante) KI-Assistenten als Premium-USP für Personaler/Ausbildungsleiter/Geschäftsführer
type: feature
---

# Content Authority Engine v1

Markt-Aktivierungs-Cut nach HR Deadline OS. Zweck: SEO + Vertrauen + Authority + Leads aus berufsbezogenen Suchanfragen.

## Routen-SSOT
- `/authority` — Hub (alle Topic-Hubs + Assets nach Kind gruppiert)
- `/authority/:topic` — Topic-Hub (z.B. `kuendigung`, `ausbildung`, `arbeitszeit`, `compliance-dsgvo`, `vertrag`)
- `/authority/checkliste/:slug` — interaktive Checkliste (Progress + .txt-Export + Print + HowTo JSON-LD)
- `/authority/vorlage/:slug` — Vorlagen-Viewer (Copy/Download .txt)
- `/authority/risiko-check/:slug` — Risk-Check-Runner (deterministisch, ampelbasiert)

## SSOT-Dateien
- `src/lib/authority/catalog.ts` — Topics + Assets (kind: tool|risk-check|checklist|template|ai-assistant|legal-hub|guide)
- `src/lib/authority/checklists.ts` — 5 Checklisten
- `src/lib/authority/templates.ts` — 5 Vorlagen (Plain-Text)
- `src/lib/authority/risk-checks.ts` — 5 Risiko-Checks + `evaluateRisk()` pure function
- Komponenten: `src/components/authority/{AssetCard,RiskCheckRunner,TemplateViewer}.tsx`

## Brücken (kein Doppel-Bau)
- HR Deadline OS (`/hr/fristenrechner-kuendigung`, `/hr/:slug`) als Tool + Legal-Hub-Asset in `kuendigung` & `ausbildung`
- ExamFit Prüfungsreife (`/suites/pruefungsreife`) als Tool-Asset in `ausbildung`
- Wissen-Hubs (`/wissen/*`) bleiben unangetastet — Authority ist die HR-/Operations-Schicht, Wissen die Lern-Schicht
- Footer (`BerufOSFooter`) verlinkt `/authority`

## Topics (Cluster)
- `kuendigung` (arbeitsrecht) — Rechner + Risk-Check Kündigungsschutz + Checkliste AG-Kündigung + Vorlage + Longtail + (geplant) KI-Prüfer
- `ausbildung` (ausbildung) — Onboarding-Checkliste + Ausbildungsplan-Vorlage + Prüfungsreife-Tool + Abbruch-Risk-Check + (geplant) Ausbildungsplaner
- `arbeitszeit` (compliance) — Zeiterfassungs-Checkliste + Arbeitszeit-Richtlinie + Compliance-Check + (geplant) Schichtplan-Validator
- `compliance-dsgvo` (compliance) — Bewerberdaten-Lösch-Checkliste + Datenschutz-Info-Vorlage + HinSchG-Readiness
- `vertrag` (vertrag) — NachweisG-Checkliste + Arbeitsvertrag-Vorlage + Befristungs-Risiko-Check

## SEO
- CollectionPage JSON-LD am Hub
- FAQPage JSON-LD pro Topic
- HowTo JSON-LD pro Checkliste
- Canonical pro Route, OG-Tags am Hub
- Reuse `react-helmet-async` (bereits provided)

## Frontend-only, Deterministic
- Keine DB-Schema-Änderungen, keine Edge-Functions, keine AI-Calls
- Vorlagen + Checklisten + Risk-Checks rein client-rendered + tokenkonform (status-bg-subtle für Ampel)
- KI-Assistenten als `live: false` Coming-Soon-Karten — Aktivierung später via Lovable AI Gateway (Loop B/C-Pattern)

## Nicht gebaut (bewusst, Activation-First-Regel)
- Keine `authority_*` Tabellen, kein Lead-Capture-Endpoint (Reuse vorhandener Lead-Capture aus HR Deadline OS möglich)
- Keine PDF-Pipeline (Plain-Text reicht für Conversion + Crawl-Budget)
- Keine Volltext-Suche (Topic-Filter + interne Verlinkung reichen für v1)

## Nächste sinnvolle Erweiterungen
1. KI-Assistent-Aktivierung (Kündigungs-Prüfer + Ausbildungsplaner) via `lovable-ai` Edge-Function
2. Lead-Capture-CTA-Bridge auf Checklisten/Risk-Checks (Reuse existierendes Newsletter/Lead-Pattern)
3. Sitemap-Eintrag in `generate-sitemap` Edge-Function für `/authority/*`
4. Verlinkung aus `WissenBerufPage`/`WissenKompetenzPage` zu passenden Authority-Topics
