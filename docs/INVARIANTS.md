# System Invariants — Non-Negotiable Rules

> **Letztes Update:** 2026-03-15  
> **Status:** Alle Invarianten aktiv und enforced

Diese Datei listet **alle** unverrückbaren Systemregeln.
Jede Invariante referenziert ihren Enforcement-Mechanismus.

---

## Kategorie 1 — SSOT & Datenfluss

### INV-001: SSOT ist die einzige Wahrheit
**Regel:** Jede kritische Definition existiert genau einmal. Duplikation ist ein Bug.  
**Enforcement:** Alle CI Guards, Code Reviews  
**Verstöße:** HARD FAIL

### INV-002: Kein direkter `job_queue.insert`
**Regel:** Jobs werden ausschließlich über `enqueueJob()` erstellt.  
**Enforcement:** `_shared/enqueue.ts` (Pool Guard), `ssot-guard.mjs`  
**Verstöße:** HARD FAIL + `SSOT_POOL_GUARD` Exception

### INV-003: Kein direkter `.from()` im Frontend
**Regel:** UI-Komponenten dürfen keine direkten Supabase-Tabellen lesen. Nur Views, RPCs oder Edge Functions.  
**Enforcement:** `scripts/guards/ssot-guard.mjs`, `ci.yml`  
**Ausnahmen:** `src/hooks/use*` (React Query Wrapper), `src/integrations/`, `src/lib/supabase`

### INV-004: Pool-Routing ist deterministisch
**Regel:** `JOB_DEFINITIONS[jobType].pool` ist die einzige Quelle für Pool-Zuweisung.  
**Enforcement:** `check-pool-contract.ts` (CI), Enqueue Guard (Runtime), Auto-Fix (Claim), stuck-scan (Sweep)  
**Verstöße:** CI FAIL + Runtime Auto-Fix + `meta.pool_autofixed` Metrik

### INV-005: Step-Order ist topologisch valide
**Regel:** `FULL_STEP_ORDER` muss ein gültiger topologischer Sort von `PIPELINE_GRAPH` sein.  
**Enforcement:** `edge-guards.ts` (CI), Runner Boot Validation (Runtime)  
**Verstöße:** CI FAIL + `SSOT_STEP_UNKNOWN` (Runtime)

---

## Kategorie 2 — Naming & Darstellung

### INV-010: Kein Roh-Titel-Rendering
**Regel:** UI darf niemals `raw_course_title`, `raw_curriculum_title` oder ungefilterte `title`-Felder anzeigen.  
**Enforcement:** `ci-ssot-guards.sh` Guard 1 (HARD FAIL)  
**Einzige Ausnahme:** `CourseNamingIntegrityPanel.tsx` (Debug-Panel, in Allowlist)

### INV-011: Kanonischer Pfad für Kursanzeigen
**Regel:** Alle Kurs-UI-Anzeigen laufen über `v_course_display_ssot` → `canonical_title`.  
**Enforcement:** `ci-ssot-guards.sh` Guard 3 (WARNING), `ssot-guard.mjs`  
**Frontend:** `useCanonicalTitles()` + `resolveTitle()`

### INV-012: Gender-inklusive Berufsbezeichnungen
**Regel:** Alle Berufsbezeichnungen verwenden `/-` Form (z.B. `Verkäufer/-in`).  
**Enforcement:** `ci-ssot-guards.sh` Guard 4 (WARNING), `course_title_aliases` (DB), `normalize_course_title()` (DB)

### INV-013: Council Badge nur mit Evidence
**Regel:** UI-Badges für "Council OK" basieren auf `council_approved_at` (Timestamp), nicht auf dem Boolean `council_approved`.  
**Enforcement:** `ci-ssot-guards.sh` Guard 2 (WARNING)  
**Erlaubt intern:** `ActiveCourseContext.tsx` (Health-Score), `CourseWorkspace.tsx` (Publish-Gate-Logik)

---

## Kategorie 3 — Quality & Content

### INV-020: Exam-Question-Zählung nur über SSOT
**Regel:** "Exam-relevant" ist definiert als `status != 'rejected' AND qc_status NOT IN ('tier1_failed', 'rejected')`.  
**Enforcement:** `v_exam_relevant_questions` (View), `count_exam_relevant()` (RPC), `ssot-guard.mjs`

### INV-021: 7 Elite Governance Constraints für approved Questions
**Regel:** Approved Questions benötigen: `curriculum_id`, `learning_field_id`, `competency_id`, `difficulty`, `cognitive_level`, `correct_answer`, `question_text` (≥ 10 Zeichen).  
**Enforcement:** 7 DB-CHECK/TRIGGER Constraints

### INV-022: Publish Gate — 6 harte Blocker
**Regel:** Auto-Publish erfordert: ≥500 Fragen, ≥40% Hard, ≥12% UNDERSTAND, ≤30% Elite-Context, ≥85% Kompetenz-Abdeckung, keine leeren Mini-Checks.  
**Enforcement:** `auto_publish` Step, `run_integrity_check` Step  
**Integrity Score:** Minimum 85/100

### INV-023: Veröffentlichte Pakete sind immutable
**Regel:** Didaktische Kerninhalte veröffentlichter Pakete dürfen nicht geändert werden.  
**Enforcement:** `guard_published_package_immutable` (DB-Trigger)  
**Erlaubt:** Metadaten-Wartung (blocked_reason, last_error, nicht-inhaltliche meta-Felder)

### INV-024: Blueprint-basierte Generierung
**Regel:** Fragen-/Content-Generierung muss blueprint-basiert sein. Keine "freie Generierung".  
**Enforcement:** `scripts/guards/blueprint-guard.mjs`

### INV-025: Kein gpt-5-nano für Learning Content
**Regel:** gpt-5-nano darf nicht für `learning_content` Intent verwendet werden (leere Antworten).  
**Enforcement:** `scripts/guards/no-nano-learning-content-guard.mjs`

---

## Kategorie 4 — Track & Pipeline

### INV-030: AUSBILDUNG_VOLL ist Standard-Track
**Regel:** `EXAM_FIRST` Track ist blockiert. Ausnahmen erfordern explizite Autorisierung.  
**Enforcement:** `trg_guard_no_exam_first` (DB-Trigger), `guard-no-examfirst-default.yml` (CI), `integrity-track-aware-guard.mjs`

### INV-031: Step-Mapping Parity
**Regel:** TypeScript SSOT (`job-map.ts`), Job-Runner (`PREREQS`), DB-View (`ops_jobtype_step_map`), Reset-Trigger müssen synchron sein.  
**Enforcement:** `check-step-mapping-parity.mjs` (CI), `assert_ops_jobtype_step_map_complete` (DB)

### INV-032: Curriculum-Mandat
**Regel:** Alle Paket-Erstellungspfade (Seeder, Auto-Waves) müssen `curriculum_id` mitschreiben.  
**Enforcement:** Runtime-Checks in Erstellungspfaden, Integrity Views

---

## Kategorie 5 — Security

### INV-040: RLS auf allen User-facing Tabellen
**Regel:** Jede Tabelle mit User-Daten hat RLS Policies.  
**Enforcement:** `rls-security-check.mjs` (CI), Hourly Security Smoke

### INV-041: LLM-Zugriff nur über Wrapper
**Regel:** Kein direkter `fetch()` zu OpenAI/Anthropic APIs. Nur `_shared/ai-client.ts`.  
**Enforcement:** `no-direct-llm-fetch-guard.mjs` (CI)

### INV-042: Lösungsschlüssel nicht in Learner-UI
**Regel:** Exam-Fragen-Antworten werden in Learner-Views ausgefiltert.  
**Enforcement:** `v_exam_questions_safe` (DB-View), Session-gebundener Zugriff

### INV-043: Keine esm.sh Imports für kritische Pakete
**Regel:** Supabase, Stripe, JSZip dürfen nicht über esm.sh importiert werden.  
**Enforcement:** ESM.SH Guard in `edge-ci.yml`

### INV-044: Kein Deno.land/std Server Import
**Regel:** Edge Functions verwenden `Deno.serve()`, nicht `deno.land/std/http/server.ts`.  
**Enforcement:** Deno.land/std Guard in `edge-ci.yml`

---

## Kategorie 6 — Operational

### INV-050: Forensische Analyse bei Fehlerbehebung
**Regel:** Jede Fehlerbehebung erfordert tiefenforensische Analyse über mehrere Ebenen.  
**Enforcement:** Ops-Prozess, Auto-Heal-Log mit vorher/nachher Beweis

### INV-051: Auto-Deploy bei Edge-Function-Änderung
**Regel:** Jede Edge-Function-Modifikation löst sofortiges Deployment aus.  
**Enforcement:** `edge-deploy-healthcheck.yml`, `deploy-smoke-check.yml`

### INV-052: Versions-Swap muss unsichtbar sein
**Regel:** Paket-Upgrades (v1→v2) sind für Endnutzer nahtlos. Kein "v2" im Produktnamen.  
**Enforcement:** Atomarer Swap an `product_id`, Naming-SSOT

---

## Referenz

- [GOVERNANCE.md](GOVERNANCE.md) — Governance-Übersicht
- [GUARD_REGISTRY.md](GUARD_REGISTRY.md) — Vollständige Guard-Liste
- [ssot-allowlist.md](ssot-allowlist.md) — Erlaubte Ausnahmen
- [SYSTEM_INTEGRITY_PLAYBOOK.md](SYSTEM_INTEGRITY_PLAYBOOK.md) — Ops-Runbook

---

## Änderungshistorie

| Datum | Änderung |
|-------|----------|
| 2026-03-15 | Initial Invariants erstellt |
