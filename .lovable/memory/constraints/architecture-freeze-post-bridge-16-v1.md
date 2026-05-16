---
name: Architecture Freeze post Bridge 16
description: Keine neuen Intelligence-Bridges. Alle Arbeit muss auf 6 Commercialization-Tracks einzahlen — Track 6 (Intelligence sichtbar) zuerst.
type: constraint
---
**Stop bei Bridge 16.** Keine neuen Intelligence-Schichten/Bridges (17+) bauen, bis reale Outcomes vorliegen.

Alle neuen Tickets müssen einem der 6 Tracks zugeordnet sein, sonst reject:
1. **B2B-Produktisierung** (Ausbildungsleiter-Dashboard, Risk Alerts, Cohort PDF-Reports, Seat Mgmt, B2B-Stripe)
2. **Daily Usage & Habit Loops** (Daily-Reminder-Email, Streak-Recovery, Daily-Challenge auf /index)
3. **Conversion & Activation** (Post-Signup-Onboarding, Referral, Activation-Funnel-Card)
4. **SEO Scale & LLM Visibility** (Wave 2+3, growth.* SSOT-Tabellen, Cannibalization-Guard)
5. **Mobile Experience** (Service Worker kill-switch-safe, Manifest, Bottom-Nav, Mobile-Lernroute-Guard)
6. **Tutor/Learner UX-Polish** (Bridge-11-16-Surfaces, Citations prominent, Forecast-Trend)

**Reihenfolge:** Track 6 → 5 → 2 → 1 → 3 → 4 (Hebel vs. Risiko).

**Track-6-Foundation gelegt 2026-05-16:** RPC `learner_get_intelligence_overview(curriculum_id)` (SECURITY DEFINER, auth.uid()-scoped, executable für `authenticated`). UI `LearnerIntelligenceCard` zeigt Cognitive-Recommendation (Bridge 14) + Exam-Window-Phase (Bridge 15) + Forecast-Probability mit Konfidenzband (Bridge 16) über `HeroDecisionCard` im LearnerDashboard. Audit jedes Aufrufs in `auto_heal_log` (action_type=`learner_intelligence_overview_call`).

**Bridge 17 (Forecast Calibration) erst freigegeben wenn:**
- ≥ N reale Exam-Outcomes vorliegen (N tbd, mindestens 30 Kohorten)
- Trainer Forecasts in Org-Console aktiv konsultieren (Telemetrie messbar)
- echte Prognosefehler dokumentiert (forecast vs actual)

Vorher: Overengineering.
