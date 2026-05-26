---
name: Operationalization Roadmap Phase A/B/C v1
description: Strategischer SSOT 2026-05-26 — 3 OS vollständig operationalisieren statt 12 halbfertig. Phase-A/B/C-Priorisierung mit Begründung pro Tier.
type: feature
---

# Operationalization Roadmap (2026-05-26)

## Leitprinzip
**Nicht 12 halbfertige OS parallel ausbauen — 3 OS vollständig operationalisieren und miteinander verdrahten.** Erst dann entsteht Plattformdichte.

Die wichtigste Erkenntnis: BerufOS hat ungewöhnlich viel Foundation (SSOT, Governance, Queueing, SEO, AI-Orchestrierung, Knowledge-Graph) — aber viele OS enden **vor dem letzten Schritt**: dem _persistent customer operations layer_. Dort entsteht jetzt der Unternehmenswert.

## Zielarchitektur
BerufOS = **ein AI-natives Operating-System für KMU**, gebaut auf 7 Plattform-Moats:
1. SSOT- / Governance-Architektur
2. Workflow / Queue / Healing
3. Blueprint- / Curriculum-Denke (übertragbar auf Prozesse, Verträge, Gespräche, SOPs)
4. Knowledge Graph (7k+ Nodes)
5. AI Governance + EU-AI-Act
6. SEO Authority
7. Multi-Agent Runtime (Foundation steht, leer)

## Tier 1 — Phase A · Marktaktivierung (sofort)

### A.1 OralExamOS → HR ConversationOS (höchster ROI, niedrigster Aufwand)
**Status:** Engine fertig · 16.362 Blueprints · Session/Turn/Scoring produktiv · nur HR-Templates fehlen.
**Pivot-Output:** Bewerbungsgespräch · Gehaltsverhandlung · Kündigung/Trennung · Feedback · Konflikt · Onboarding · Mitarbeitergespräch · Führung · Vertrieb/Kunde · Arzt-Patient · Compliance-Briefing.
**Architektur-Cut:** Domain-Separation via Spoke-Tabelle `conversation_os_scenarios` (KEIN Fork des Exam-Pfads, bridge über Engine-Reuse). Sessions/Turns/Scoring werden in Cut 1 via Engine-Adapter wiederverwendet.

### A.2 FördermittelOS Persistence Layer (höchste Business-Priorität)
**Status:** Stärkste Engine, beste SEO, starkes Matching — aber kein persistentes Kundenmodell.
**Output:** Förderfall · Antrag · Dokumente · Fortschritt · Fristen · Bearbeitungsstatus · Förderakte · Follow-ups · CRM/Pipeline.
**SSOT-Erweiterung:** Reuse `b2b_leads` als Lead-SSOT, neue Spoke `foerdermittel_cases` + `foerdermittel_documents` + `foerdermittel_deadlines`. Bridge zu `conversion_events` und `email_delivery_queue`.

### A.3 UnternehmenscockpitOS mandantenfähig
**Status:** Operator-zentriert vorhanden (Snapshots, Intelligence, Risk-Signals, Coordination, Simulationen, Governance, Drift Detection).
**Pivot:** Mandantenfähig → wird zum Dach über allen OS. Unternehmensscore · AI-Reifegrad · Risiko · Fristen · Compliance · Förderstatus · Mitarbeiter · AI-Nutzung · Handlungsempfehlungen.

## Tier 2 — Phase B · Betriebsintelligenz

### B.1 WissensOS → Unternehmens-RAG
Knowledge Graph steht. Fehlt: Dokumenten-Workspace · Firmenwissen · „Frag dein Unternehmen" · semantische Suche · Retrieval über Firmendokumente. Aktiviert anschließend ComplianceOS / VertragscheckerOS / ProzessOS / MitarbeiterOS / MeetingOS.

### B.2 ComplianceOS produktisieren
DB-Skelett da, Governance-Denke vorhanden. Quickest path: DSGVO-Verzeichnis · TOM-Generator · AI-Provider-Compliance · Risiko-Checks · Dokumentenpflichten · Fristen. Passt zu Fördermittel + Cockpit.

### B.3 Cross-OS Eventbus aktivieren
`berufs_ki` Workflow-Engine + 6 Agents existieren, 0 Runs. Bridge-aktivierung verbindet die 3 Phase-A-OS.

## Tier 3 — Phase C · Deep Operations (NICHT vor Phase A+B)
1. VertragscheckerOS (braucht WissensOS-RAG)
2. ProzessOS (braucht Wissen/Verträge/Meetings/Mitarbeiter)
3. MitarbeiterOS (zuerst Daten via HR ConversationOS sammeln)
4. MeetingOS (Action Extraction + Decision Tracking, später)

## Entscheidungskriterium pro Cut
„Stärkt das die **Operationalisierung** einer der 3 Phase-A-OS ODER verdrahtet sie?" Wenn Nein → nicht bauen.

## Cut-Sequenz Phase A.1 (HR ConversationOS)
- **Cut 0:** `conversation_os_scenarios` SSOT + 12 Premium-Seeds + 2 Public-RPCs + Premium-Showroom `/os/conversation` + 3 Audit-Contracts.
- **Cut 1:** Engine-Adapter zu `oral_exam_sessions`-Pipeline (curriculum-frei via `scenario_id`-Discriminator) + Live-AI-Dialog Edge `conversation-os-run`.
- **Cut 2:** Premium-UX: Voice-Input, Echtzeit-Feedback, Coaching-Rubric, Replay & Verbesserungs-Plan.
- **Cut 3:** B2B-Mode (Mitarbeiter-Coaching, Manager-Dashboard, Multi-Seat).
