---
name: FördermittelOS Cut 1
description: Fördermittel-Intelligence Layer 1+3 (Registry SSOT + Matching Engine) + Hub/Programm/Thema-Pages. Layer 2/4/5 (Ingestion, Execution OS, CoPilot) als nächste Cuts.
type: feature
---

## Architektur (5 Layer)

1. **Registry OS (Cut 1)** — `src/lib/foerdermittel/types.ts` + `registry.ts` als SSOT. Entity-Modell: Program (authority, region, topics, kind, funding range, status, requirements hard/soft, docs, sources, historicalApprovalRate, combinableWith, seoKeywords). Seed-Index: 12 Programme (Bund: go-digital, Digital Jetzt, QCG, ZIM, BAFA EBM, BAFA BEG EM, KfW 380, Ausbildungsprämie, EXIST; Länder: NRW Digitalbonus, BW Digitalisierungsprämie, Bayern Digitalbonus).
2. **Intelligence Engine** — NOCH NICHT: AI-Normalisierung + Change Detection via Edge Function + Cron geplant.
3. **Matching Engine (Cut 1)** — `matching.ts` deterministisch: regionMatches × sizeMatches × topicOverlap × statusFactor. Probability = historicalApprovalRate ± size/overlap/status modifiers. rankNoise() → excellent (≥70) / good (45-69) / watch (rest+disqualified).
4. **Execution OS** — NOCH NICHT: Fristen-Timeline, Dokumentenprüfung, Antragsschritte.
5. **AI CoPilot** — NOCH NICHT: Edge Function mit Lovable AI Gateway (default `google/gemini-3-flash-preview`), Kombinations-Analyse, Anschreiben-Generator.

## Routen

- `/foerdermittel` → Hub mit Hero, Matching-Wizard, Layer-Erklärung, Themen-Cluster
- `/foerdermittel/programm/:slug` → Detail mit Schema.org GovernmentService, Voraussetzungen, Dokumente, Kombinierbarkeit, Quellen
- `/foerdermittel/thema/:topic` → Cluster (digitalisierung|weiterbildung|energie|gruendung)
- `/fördermittel` → Redirect

## Komponenten

- `MatchingWizard` — Region, Größe, Mitarbeiter, Branche, Topics (Toggle-Pills). Deterministisch, kein Backend.
- `ProgramCard` — Fit/Probability/Warnings/Reasons inline.

## Footer

BerufOSFooter zeigt jetzt: Live-Demo, HR Deadline OS, Authority Hub, AngebotsvergleichOS, FördermittelOS.

## Nächste Cuts

- **Cut 2**: Ingestion-Pipeline (Edge Function + Cron für RSS/Sitemap-Crawl BAFA/KfW/L-Bank), `program_revisions` Tabelle für Change Detection.
- **Cut 3**: CoPilot (Edge Function via Lovable AI Gateway): "Kann ich BAFA + Landesförderung kombinieren?", Antragsentwurf.
- **Cut 4**: Execution OS — Fristen-Timeline pro angelegtem Projekt, learner-scoped via Lovable Cloud.
- **Cut 5**: FörderRadar — Alerts bei neuen/geänderten Programmen via email_delivery_queue Worker.

## Anti-Drift

- Keine parallele Tabelle/RPC angelegt — Registry ist client-SSOT bis Pipeline kommt. Bridge dann via Supabase-Migration & types-Spiegelung, KEINE Hardcoded-Mock-Daten parallel zu Live-Daten halten.
- Disclaimer "ersetzt keine verbindliche Förderberatung" auf Detail-Page verpflichtend.
- Lovable AI Gateway erst in Cut 3 verdrahten — kein Mock-AI-UI bauen.
