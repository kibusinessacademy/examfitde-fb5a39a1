---
name: ExamFit System Rules (20 Regeln, verbindlich)
description: Verbindliche Konstitution für SSOT, Prüfungslogik, SQL-Disziplin, Pipeline-Invariants, Governance, AI, Frontend und Lovable-Arbeitsweise. Anwendbar auf JEDE technische Änderung.
type: preference
---

# ExamFit System Rules v1

**Verbindlich für jede technische Änderung — SQL, Edge-Functions, RPCs, Triggers, Cron, Frontend, AI.**
Repo-SSOT: `docs/SYSTEM_RULES.md`. CI-Enforcement: `scripts/guards/sql-discipline-guard.mjs`.

## 1. Grundprinzip
Prüfungslogisches Lernsystem (kein CMS). Priorität: **SSOT → Prüfungslogik → Didaktik → Reproduzierbarkeit → Automatisierung → UI**. Frontend ersetzt NIE Systemlogik.

## 2. SSOT
Genau eine Wahrheit pro Domäne. Verboten: Shadow-State, doppelte Business-Logik, direkte Tabellenreads im Client, freie Statusstrings, manuelle Workarounds ohne Audit. Pflicht: Views/RPCs als Zugriffsschicht, zentrale Statusdefinitionen, jede Mutation versioniert.

## 3. Artifact Truth > Step Status
`step.status='done'` ⇔ Ziel-Artifact materialisiert. Status allein ist KEIN Beweis.
- `generate_exam_pool` → `exam_questions` rows
- `generate_learning_content` → `content_hash` gesetzt
- `generate_blueprint_variants` → Varianten existieren
- `build_ai_tutor_index` → Index-Artefakte existieren
- `generate_oral_exam` → Oral-Fragen existieren

## 4. Idempotenz
`ON CONFLICT`, Aktiv-Job-Dedup, Dedup VOR Unique-Index, Logs dedupliziert. Verboten: blindes INSERT, doppeltes Enqueue, Retry ohne Zustandsänderung, Trigger-Loops.

## 5. Queue-Safety
Job nur enqueuen wenn: DAG-Prereqs ✓, kein aktiver Doppel-Job ✓, kein Quarantine/Paused ✓, `run_after` ✓, Lane-Isolation ✓.
- Aktiv: `status IN ('pending','queued','processing')`
- Dedup-Key (min): `package_id + job_type + mode`

## 6. DAG-Regel
Hart. Keine Downstream-Jobs ohne erfüllte Upstream-Steps. Keine Governance-Finalisierung durch generische Healer. Keine Step-Reihenfolge im Frontend. Pflicht: DAG-Guard, auditierbarer Block, Loop-Counter, deduplizierte Logs.

## 7. Governance-Isolation
`run_integrity_check`, `quality_council`, `auto_publish` NUR durch eigene Edge-Function finalisierbar. Verboten: generische Auto-Healer, direkte Enqueue-Bypasses, Phantom-Done ohne `meta.executed=true`.

## 8. Fail-Fast
`NO_EFFECT` → kein Retry. `NO_PROGRESS` → Eskalation. `MATERIALIZATION_BLOCKED` → cancel statt retry. `REPAIR_EXHAUSTED` → Permanent-Fix-Task. Keine endlosen Retries, keine stillen Fehler.

## 9. Auto-Heal
Nur deterministische, dokumentierte Fixes. Darf: DAG-konformes Enqueue, stale Locks lösen, bekannte Blocker resetten, Repair-Jobs starten. Darf NIE: Qualitätsgrenzen heimlich senken, Content erfinden, Daten verschlechtern, Ursachen kaschieren, Governance-Steps finalisieren.

## 10. Permanent-Fix-Backlog
`heal_permanent_fix_tasks` Pflichtfelder: `pattern_key`, `cluster`, `package_id`, `priority`, `title`, `description`, `recommendation`, `status`. Dedup ist Pflicht.

## 11. SQL-Regeln (CI Hard-Block)
**Schema-Realitäts-Check ZUERST (Pflicht vor jeder Migration):**
1. Tatsächliche Spaltenstruktur via `information_schema.columns` / Live-DB prüfen — nie aus Erinnerung, `types.ts` oder älteren Migrationen ableiten.
2. Exakte Spaltennamen, Typen, Casing, NULLability, Defaults verifizieren.
3. Enum-/Check-Constraints (`pg_enum`, `check_constraints`) prüfen, nur existierende Werte nutzen.
4. Duplikate / Unique-Konflikte vor `UNIQUE`/`ON CONFLICT` prüfen.
5. Echte `job_type`/`step_key`/`status`/`action_type` gegen Live-Enums prüfen.
6. **Mismatch-Verbot**: Bei Abweichung Annahme↔DB STOPP, dokumentieren, neu planen.
7. **Schema-Drift-Verbot**: keine parallelen Wahrheiten (z. B. `price_cents` vs `amount_cents`) — sofort konsolidieren.

**Verboten:** `COUNT()`, `SELECT INTO` ohne `*`, `RETURNING INTO` ohne `*`, freie Statuswerte ohne Constraint, `SECURITY DEFINER` ohne `REVOKE/GRANT`, `GRANT … TO authenticated` auf `admin_*`/`v_admin_*`.
**Pflicht:** `COUNT(*)`, `SELECT * INTO`, `RETURNING * INTO`, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role`, Admin-RPC mit `has_role(auth.uid(),'admin')`.

## 12. Security
Admin-Daten NIE direkt an `authenticated`. Verboten: Admin-Views an authenticated, interne Tabellen im Frontend, Service-Role-Logik im Client, Secrets im Repo. Erlaubt: Admin-RPC mit `has_role`, service_role-only interne Views, RLS-konforme Public Views.

## 13. Logging-Contract
Pro Mutation: `action_type`, `trigger_source`, `target_type`, `target_id`, `result_status`, `reason_code`, `before_state`, `after_state`, `metadata`. Logs dedupliziert.

## 14. AI-Regel
AI erzeugt KEINE neue Wahrheit. Darf: Vorschläge, Varianten aus Blueprints, Feedback erklären, Lernpfade empfehlen. Darf NIE: Curriculum verändern, Prüfungslogik erfinden, Fragen ohne Blueprint, Tutor-Antworten ohne SSOT-Kontext.

## 15. Blueprint-Regel
Blueprints = SSOT für Prüfungsfragen. Jede Frage referenziert: `blueprint_id`, `competency_id`, `learning_field_id`, Schwierigkeit, Prüfungsrelevanz, typische Fehler. Keine freie Einzelgenerierung.

## 16. Prüfungssystem-Regel
Optimierung auf Prüfungsreife, NICHT Content-Menge. Pflichtmetriken: Frageanzahl, LF-Coverage, Kompetenz-Coverage, Bloom-Verteilung, Schwierigkeitsverteilung, Kontext-Isolation, Prüfungsrelevanz.

## 17. Frontend-Regel
Anzeige- und Interaktionsschicht. Darf NIE: Business-Regeln entscheiden, Pipeline-Zustände berechnen, Tabellen direkt lesen, Status ableiten, Repairs orchestrieren. Nutzt: RPCs, geprüfte Views, typed Services, klare Admin-Actions.

## 18. Testpflicht
Jede Migration: Prüfquery oder Test-RPC. Pflichttests: Syntax, Security-Grants, Idempotenz, keine Duplikate, keine aktiven Jobs in Paused-State, Artifact Truth, DAG-Konsistenz.

## 19. Lovable-Arbeitsweise
Vor JEDER Änderung: (1) Annahmen auflisten, (2) **Schema-Realitäts-Check zuerst** — tatsächliche Spaltenstruktur/-namen/-typen/Enums gegen Live-DB prüfen (siehe Regel 11), (3) **Mismatches & Schema-Drifts aktiv vermeiden** — Abweichungen Annahme↔Code↔Memory↔DB sofort konsolidieren, (4) DB-/Code-Realität insgesamt prüfen, (5) Patch minimal, (6) Guards ergänzen, (7) Tests/Prüfqueries, (8) KEINE erfundenen Tabellen/Spalten/RPCs/Statuswerte.

## 20. Goldene Regel
**Guard vor Repair. Artifact vor Status. Fail-Fast vor Retry. SSOT vor UI. Prüfungslogik vor Content.**

---

## Permanente Lovable-Direktive

> Arbeite bei ExamFit wie ein Senior Database Engineer, Pipeline Architect und IHK-Prüfungsdidaktiker.
> Keine technischen Annahmen ungeprüft verwenden.
> Keine SQL-Migration ohne Schema-Prüfung.
> Keine neuen job_type, step_key, status oder enum-Werte ohne Live-Abgleich.
> Keine UI-Logik statt SSOT.
> Jede Mutation muss idempotent, auditierbar und rollback-sicher sein.
> Jeder Step ist nur done, wenn das Ziel-Artifact existiert.
