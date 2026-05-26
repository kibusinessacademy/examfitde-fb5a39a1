# Cut 6.1 — Unified Competency Graph + HR Activation Demo

**Persona-Fokus:** HR / Ausbildungsleiter (B2B-Einstieg, höchste Deal-Größe)
**Output-Modus:** Hybrid (kuratiert aus DB + AI-Personalisierungs-Layer)
**Architektur-Prinzip:** EXTEND_EXISTING. Keine parallelen Systeme — Bridge auf bestehende Tabellen (`curricula`, `competencies`, `blueprints`, `lessons`, `exam_questions`, `oral_scenarios`, `seo_*`).

---

## Strategischer Rahmen

Nach Stabilisierung (Cut 5/5.1) und Market-Activation-Pivot ist der Hebel: **Erstnutzer in 3–5 Min den Wert spüren lassen**. Cut 6.1 wählt bewusst den Cut-7-P0-Baustein (Unified Competency Graph) als Fundament, **weil er beide Hebel gleichzeitig zahlt**:
1. **Strategisch:** SSOT-Graph wird langfristiger Moat (Lernen ↔ Arbeiten ↔ SEO ↔ Workflow).
2. **Aktivierung:** Sofort gibt es eine HR-Demo, die aus dem Graph echte Module + Szenarien zeigt — keine Mock-Screens.

---

## Scope (3 Lieferungen, sequenziell)

### L1 — Unified Competency Graph SSOT (P0)

**Eine** read-only View + **eine** RPC, die alle bestehenden Knoten zu einem Graphen verbindet. **Keine** neue Schreib-Tabelle für Knoten — der Graph ist eine Projektion.

```text
Beruf (course_packages)
 └── Lernfeld (learning_fields)
      └── Kompetenz (competencies)
           └── Blueprint (blueprints)
                ├── Lesson (lessons)
                ├── Exam Question (exam_questions)
                ├── Oral Scenario (oral_scenarios)
                ├── SEO Authority Content (certification_seo_pages, persona_landing)
                └── (später: Workflow Pattern, Tutor Context)
```

**Neue Artefakte (minimal):**
- `v_unified_competency_graph` — denormalisierte Sicht: pkg → field → comp → bp → counts({lessons, qs, oral, seo})
- `admin_get_competency_graph_for_package(_package_id uuid)` — service_role-gated SECURITY DEFINER RPC, gibt JSON-Tree zurück
- `public_get_demo_competency_summary(_package_id uuid)` — anon-gated, **read-only**, NUR published Pakete, nur Counts + Titel (kein PII, keine Question-Inhalte)
- Audit-Contract `competency_graph_demo_view` in `ops_audit_contract` (Pflicht-Keys: `package_id`, `requester_persona`)

**KEINE** neue Tabelle. Wenn später Workflow-Patterns dazukommen (Cut 7), bekommen sie eine separate Tabelle `workflow_patterns(competency_id, …)` als Spoke — nicht im Graph-Knoten selbst.

---

### L2 — HR Activation Demo (`/demo/hr`)

Eine einzige Route, eine Experience. Drei Schritte:

1. **Input (15 Sek):** Branche + Teamgröße + akuter Schmerzpunkt (Dropdown: "Kündigungsgespräche", "Onboarding", "Compliance-Schulung", "Mitarbeiterentwicklung", "Konflikte", "Ausbildung").
2. **Curated Match (deterministisch):** Mapping Schmerzpunkt → 1–3 published Pakete + relevante Kompetenzen (aus L1-View). Anzeige: passende Module, Kompetenzlisten, Zähler (X Lessons, Y Prüfungsfragen, Z Oral-Szenarien).
3. **AI Personalisierung (1 Call, gestreamt):** Edge-Function `hr-demo-personalize` ruft Lovable AI Gateway (`google/gemini-3-flash-preview`), erhält {input, matched_competencies}, gibt zurück:
   - 3 konkrete Anwendungsfälle für *dieses* Team
   - 1 vorgeschlagenes Oral-Szenario aus dem Pool (Pointer, nicht generiert)
   - 1 messbare KPI-Empfehlung
   - CTA-Pfad (zu konkretem Paket-Checkout oder Enterprise-Kontakt bei Team ≥ 25)

**Tracking:** Jede Demo emittiert 4 `conversion_events`: `demo_started`, `demo_match_shown`, `demo_personalize_completed`, `demo_cta_clicked` — alle mit `package_id` (Generated Column SSOT), `persona='hr'`, `source='demo_hr'`.

**Rate-Limit & Kosten:** AI-Call gated über `fn_demo_rate_limit_check(ip_hash, window=1h, max=5)` — Schutz vor Missbrauch.

---

### L3 — Activation Score Hook (P1, Vorbereitung)

Nur Schema + Producer, kein UI/Sales-Logik in Cut 6.1.
- `lead_activation_signals(lead_id, signal_type, weight, package_id, persona, created_at)` — append-only
- `record_activation_signal(...)` RPC mit RLS (eigener Lead-Kontext)
- L2 schreibt automatisch Signale (Score-Berechnung kommt in Cut 6.2)

---

## Was NICHT in Cut 6.1

- One-Click Scenario Demos (6 Szenarien) → Cut 6.2
- Ideas Engine (PDF-Upload) → Cut 6.3 (eigener Cut, Upload-Pipeline + Storage)
- Weitere Personas (Pflege, Azubi, Handwerk) → Cut 6.2 (Persona-Pattern wiederverwendbar nach L2)
- Workflow-Patterns als Graph-Knoten → Cut 7
- Authority Engine auto-Generation aus Kompetenz → Cut 7
- Activation Score UI / Sales-Dashboard → Cut 6.2

---

## Architectural Continuity Check (Pflicht vor Build)

| Regel | Status |
|---|---|
| SSOT_FIRST | ✅ Bestehende Tabellen, Graph = View-Projektion |
| EXTEND_EXISTING | ✅ Nutzt curricula/competencies/blueprints/lessons/exam_questions |
| NO_PARALLEL_SYSTEMS | ✅ Kein zweiter Kompetenz-Store |
| BRIDGE_DONT_FORK | ✅ View bridged, forkt nicht |
| GOVERNANCE_BEFORE_AUTOMATION | ✅ Audit-Contract vor RPC-Live |
| NO_HIDDEN_STATE | ✅ Alle Demo-Events in conversion_events |
| AUDITABLE_MUTATIONS | ✅ fn_emit_audit für Demo + Signal |
| FAIL_VISIBLE | ✅ Rate-Limit / AI-402/429 als Toast |
| SECURITY_INHERITS | ✅ public-RPC nur published + minimal exposure |
| NO_AUTONOMOUS_PRODUCTION_WRITES | ✅ Nur Signal-Writes, keine pkg-Mutation |

---

## Technische Schritte (Reihenfolge)

1. **Migration A** — View `v_unified_competency_graph` + RPC `admin_get_competency_graph_for_package` + Audit-Contract registrieren
2. **Migration B** — Public RPC `public_get_demo_competency_summary` (nur published, anon-gated) + Schmerzpunkt-Mapping-Tabelle `hr_demo_painpoint_map(painpoint_key, competency_match_query jsonb, weight int)` (Seed: 6 Schmerzpunkte)
3. **Migration C** — `lead_activation_signals` + RLS + `record_activation_signal` RPC + `fn_demo_rate_limit_check`
4. **Edge Function** — `hr-demo-personalize` (Lovable AI Gateway, system prompt server-side, streaming SSE, 402/429 surfacing)
5. **Frontend** — Route `/demo/hr` (Input-Form → MatchResults-Card → PersonalizedInsights-Stream → CTABlock). Design-Tokens v2, mobile-first (411px Viewport).
6. **Tests** — Smoke: Public-RPC liefert nur published; Rate-Limit blockt 6. Call; conversion_events landen mit package_id; A11y axe-Lauf auf neuer Route.
7. **Memory-Update** — `mem://architektur/marketing/cut-6-1-hr-demo-and-competency-graph-v1.md` + Index-Eintrag.

---

## Akzeptanzkriterien

- `/demo/hr` lädt < 1.5s (initial), Personalisierung-First-Token < 3s.
- 100% der Demos emittieren alle 4 conversion_events mit korrektem `package_id`.
- Public-RPC gibt 0 unpublished/draft-Pakete zurück (SQL-Smoke).
- Rate-Limit blockt 6. Call pro IP/h mit klarem Fehler.
- Kein Treffer für `text-white`/`bg-X/10`-Antipatterns im neuen Frontend-Code (Design-Tokens v2).
- Architectural-Continuity-Page green für alle neuen Artefakte.
- Full Vitest Suite bleibt grün (Gate vor Memory-Freeze).

---

## Erwartetes Ergebnis nach Cut 6.1

- Vertriebsfähige Live-Demo für HR-Buyer mit echten Outputs aus eigener Daten-SSOT.
- Unified Graph als Fundament für Cut 6.2 (weitere Personas in Stunden statt Tagen) und Cut 7 (Workflow-Patterns als Spoke ohne Refactor).
- Erste Activation-Signale fließen ein — Datengrundlage für Cut 6.2 Score-Engine.
