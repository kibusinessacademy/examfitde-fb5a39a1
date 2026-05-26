---
name: ConversationOS Vertical Modules v1
description: ConversationOS ist Plattform — verkauft wird über 6 vertikale Module (HR Interview, MedTalk, Leadership, Sales, Support Escalation, Compliance). Gleiche Engine, branchenspezifische Skins.
type: feature
---

# ConversationOS — Vertical Productization (SSOT)

## Leitsatz
Niemand kauft „ConversationOS". Menschen kaufen **bessere Bewerbungsgespräche**, **sicherere Patientengespräche**, **bessere Discovery Calls**, **weniger Eskalationen**, **bessere Führungsgespräche**.

→ ConversationOS = Plattform (Engine).
→ Verkauft werden vertikale Module (Branchen-Skins).

## Architektur-Prinzip
- **Eine Engine, sechs Produkte**: `conversation_os_scenarios` bleibt SSOT.
- Neue Spalte `vertical_module` (TEXT, normalized key) gruppiert Szenarien.
- Jede Vertikale ist eigener Funnel: eigene Landingpage, eigene CTAs, eigene Käuferpersona, eigenes Pricing.
- Engine, Runtime, Scoring, Personas, Rubrics bleiben identisch.

## Die 6 Vertikalen

| Modul-Key | Käufer | Outcome | Kern-Szenarien |
|---|---|---|---|
| `hr_interview_os` | Recruiter / HRBP / Teamleiter | Bessere Einstellungen | Bewerbung, Gehalt, Trennung |
| `leadership_os` | Führungskräfte / Manager | Bessere Führung, weniger Konflikte | Feedback, Konflikt, Onboarding, 1:1, GROW |
| `med_talk_os` | Ärzte / Pflege / Klinik | Bessere Patientenkommunikation | SPIKES, Aufklärung, Angehörige |
| `sales_conversation_os` | AE / Sales / CS | Höhere Conversion | Discovery, Preisverhandlung, Einwand |
| `support_escalation_os` | Customer Support | Weniger Eskalationen | Difficult customer, Beschwerde |
| `compliance_conversation_os` | Banken / Versicherungen / Compliance | Audit-Sicherheit | DSGVO-Briefing, Audit-Vorbereitung |

## Konkrete Mapping (12 aktuelle Seeds)
- `hr_interview_os` → hr_job_interview_specialist, hr_salary_negotiation, hr_termination_humane
- `leadership_os` → hr_feedback_critical, hr_conflict_mediation, hr_onboarding_kickoff, hr_one_on_one, leadership_coaching_grow
- `med_talk_os` → medical_patient_briefing
- `sales_conversation_os` → sales_discovery_b2b
- `support_escalation_os` → service_difficult_customer
- `compliance_conversation_os` → compliance_short_briefing

## Produkt-Moat
Was uns von Chatbots/Prompts unterscheidet:
1. Standardisierte Szenarien (Blueprint-Struktur wie exam_blueprints)
2. Kompetenzbewertung mit Rubrics
3. Difficulty + Progression + Mastery
4. Personas (azubi/betrieb/institution)
5. Wiederholbarkeit + Verlauf + Zertifikate
6. Branchenwissen aus Curricula/Kompetenzen

→ **operationalisierte Gesprächskompetenz**, nicht Rollenspiel.

## Routen (URLs)
- `/os/conversation` → Plattform-Übersicht (6 Vertikalen als Karten)
- `/os/hr-interview` → HR InterviewOS Landingpage
- `/os/leadership` → LeadershipOS Landingpage
- `/os/med-talk` → MedTalkOS Landingpage
- `/os/sales-conversation` → SalesConversationOS Landingpage
- `/os/support-escalation` → SupportEscalationOS Landingpage
- `/os/compliance-conversation` → ComplianceConversationOS Landingpage

Alle Vertikalen nutzen die Component `VerticalModulePage` (Tokens, Premium-UX).

## Nicht-Ziele
- Kein neuer Engine-Code pro Vertikale
- Keine getrennten Szenario-Tabellen
- Keine neue AI-Infrastruktur pro Branche
- Keine generische „AI-Trainer"-Sprache in der UI
