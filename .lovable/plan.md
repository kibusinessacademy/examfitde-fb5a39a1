# ExamFit Premium Learning Experience — Master Plan

## Trigger-Gate (vor Phase 1.1)

Bevor ein einziger Cut startet, müssen folgende Bedingungen GREEN sein:

1. DNS-Cutover auf `examfit.de` via Vercel erfolgreich
2. 7 Tage Stabilität (keine 5xx-Spikes, kein SEO-Coverage-Drop)
3. Post-Cutover-Smoke (Title, Canonical, JSON-LD) 7d grün
4. Architecture Freeze post Bridge 16 re-checked
5. `EDGE_INTERNAL_SHARED_SECRET` Monitoring aktiv

Fällt einer aus → Phase 1.1 wird verschoben, kein Workaround.

---

## Phase 1.1 — Premium AI Tutor (Persona + Recovery)

**Ziel:** Tutor fühlt sich wie persönlicher Coach, nicht wie generischer Chatbot. Strict-RAG bleibt unverändert.

- **1.1.a** `derivetutorPersonaMode()` in `personaRouter.ts` (deterministisch, truth-table)
- **1.1.b** `ai-tutor/index.ts` — Persona-spezifischer Ton + Frage-Stil (Strict-RAG Pflicht)
- **1.1.c** Mobile-First Redesign `LearnerTutorPanel` / `AiTutorChat` (411px, sticky input, Markdown, Source-Chips)
- **1.1.d** Recovery-UX-Bridge zu Bridge 4 NBA (keine neuen job_types)
- **1.1.e** Stagnation-Detection-Surface (read-only, keine neuen Tabellen)

**Acceptance:** Truth-table 100%, `ai_tutor_audit.persona_mode` befüllt, Refusal + `[SOURCES]` erhalten, axe green, 411px single-CTA.

---

## Phase 1.2 — Daily Learning Loop (Mission · Momentum · Streak)

**Ziel:** Tägliche Rückkehr-Gewohnheit. Erste Phase mit neuen SSOTs.

- **1.2.a** SSOT `daily_mission` (eine aktive Mission pro Lerner pro Tag, abgeleitet aus Bridge 4 NBA)
- **1.2.b** SSOT `momentum_score` (rolling 7d, deterministisch berechnet, kein ML)
- **1.2.c** Streak-Engine (idempotent, Timezone-aware, Grace-Period)
- **1.2.d** Mobile Home-Screen `/app` — Mission-Card oben, Momentum-Ring, Streak-Flame
- **1.2.e** Push/Re-Entry-Bridge zu Track 5 Notification-Loop

**Acceptance:** Mission deterministisch, Momentum reproduzierbar, Streak idempotent, Audit-Contracts registriert, Pflicht-Smoke 3-Tage-Loop.

---

## Phase 1.3 — Mobile Focus Flow (TikTok-style Learning)

**Ziel:** 1-Hand-Bedienung, Vollbild-Fokus, sofortiger Resume. Reine Frontend-Phase.

- **1.3.a** `FocusSession` Fullscreen-Layout (swipe up/down, no-scroll)
- **1.3.b** Resume-State persistiert lokal (IndexedDB) + server (`learner_session_state`)
- **1.3.c** Haptik + Micro-Animations (Motion for React, max 200ms)
- **1.3.d** A11y: reduce-motion, screen-reader fallback
- **1.3.e** Performance-Budget: LCP < 1.8s auf 4G

**Acceptance:** 411px single-hand reachable, Resume < 300ms, axe green, Lighthouse Mobile ≥ 90.

---

## Phase 1.4 — Emotional Progression (Ringe · Wellen · Copy)

**Ziel:** Visueller Layer über bestehende Examiner-/Mastery-SSOTs. Kein neues Backend.

- **1.4.a** Competency-Rings (3-Ring-Modell: Wissen · Anwendung · Prüfungsreife)
- **1.4.b** Wave-Visualisierung Mastery-Trend (4 Wochen rolling)
- **1.4.c** Copy-Refresh: motivierend, nicht infantil (Tone-Guide)
- **1.4.d** Examiner-Consciousness Hover/Tap-States für Erklärbarkeit

**Acceptance:** Pure-View-Layer, keine RPC-Änderung, Storybook-Snapshots, axe green.

---

## Phase 1.5 — Exam Day Mode + Oral Premium

**Ziel:** Letzte Meile zur Prüfung. Stress-reduzierend, hochfokussiert.

- **1.5.a** Exam-Day-Mode (T-7/T-3/T-1/T-0 Layouts, Readiness-Authority gated)
- **1.5.b** Oral Trainer Premium-UX (Voice-In, Echtzeit-Feedback)
- **1.5.c** Confidence-Calibration (selbst vs. real)
- **1.5.d** Post-Exam-Recovery-Flow

**Acceptance:** Readiness-Authority bindend, Voice-Pfad opt-in, kein Stress-Trigger.

---

## Architektur-Invarianten (alle Phasen)

- SSOT_FIRST · EXTEND_EXISTING · NO_PARALLEL_SYSTEMS
- Architectural Continuity Guard Pflicht-Check vor neuen Tabellen/RPCs
- Audit via `fn_emit_audit` + `ops_audit_contract`
- Design-System v2 Tokens (keine `text-white`/`bg-X/10`)
- Mobile-first 411px primary viewport
- Strict-RAG für jede AI-Generation
- Keine Client-side AI-Calls

## Reihenfolge & Risiko

```
[Cutover GREEN +7d]
       ↓
   Phase 1.1  ← Frontend + Persona-Routing (low risk)
       ↓ (7d Beobachtung)
   Phase 1.2  ← erste neue SSOTs (medium risk, Architecture-Review)
       ↓ (7d Beobachtung)
   Phase 1.3  ← reines Frontend (low risk)
       ↓
   Phase 1.4  ← View-Layer (low risk)
       ↓
   Phase 1.5  ← Exam-Day + Oral (medium risk)
```

Zwischen jeder Phase: 7d Stabilitätsfenster, KPI-Review, kein paralleler Start.

## Out-of-Scope (explizit)

- Gamification mit Badges/Punkten ohne Lernbezug
- Social-Features / Leaderboards
- Eigene Native App (PWA reicht)
- ML-Recommender (deterministische Regeln + LLM-Coach)
- Neue Payment-/Pricing-Logik
