---
name: ExamFit System Rules v1 (SQL + Pipeline + Observability)
description: Verbindliche Konstitution für SQL-Migrations, Queue/Step/Heal-Pipeline, Observability und Admin-Operationen. Anwendbar auf JEDE DB- oder Pipeline-Änderung.
type: preference
---

# ExamFit System Rules v1

**Verbindlich für alle SQL-Migrations, Edge-Functions, RPCs, Triggers, Cron-Jobs und Admin-RPCs.**
Diese Regeln werden CI-seitig durch `scripts/guards/sql-discipline-guard.mjs` (Hard-Block) erzwungen.

---

## A. SQL-Phasen-Workflow (PFLICHT vor jeder Migration)

1. **Schema prüfen** — `supabase--read_query` auf `information_schema` / `pg_proc` / `pg_constraint`:
   - existieren Tabellen, Spalten, Functions?
   - Statusfelder = TEXT, ENUM, CHECK?
   - bestehen Duplikate vor neuen UNIQUE-Indexes?
   - heißen `job_type` / `step_key` / `status` exakt wie in `job_queue` / `package_steps`?
2. **Annahmen listen** — vor SQL alle Annahmen explizit benennen + gegen DB verifizieren.
3. **Migration schreiben** — strict, idempotent, dedupe-vor-unique, security-hardened.
4. **Migration validieren** — am Ende der Migration Invariant-RPC oder Test-Query.
5. **Pre-Deploy grep** —
   ```
   rg "COUNT\(\)|SELECT\s+INTO|RETURNING\s+INTO|SECURITY DEFINER|GRANT.*authenticated" supabase/migrations
   ```

## B. Verbotene SQL-Muster (CI Hard-Block)

- `COUNT()` ohne `*` → IMMER `COUNT(*)`
- `SELECT ... INTO v_var FROM ...` ohne `*` → IMMER `SELECT * INTO v_var FROM ...`
- `RETURNING INTO v_var` ohne `*` → IMMER `RETURNING * INTO v_var`
- harte Statuswerte (`'paused'`, `'merged_duplicate'`, `'failed_soft'`) ohne ENUM/CHECK-Prüfung
- neue `job_type`-Namen ohne DB-Abgleich
- `SECURITY DEFINER` ohne nachfolgendes `REVOKE ALL FROM PUBLIC` + gezieltes `GRANT EXECUTE`
- Admin-Views direkt an `authenticated` (nur via RPC mit `has_role('admin')`)

## C. Pflicht-Bestandteile jeder Migration

- Syntax-Checks (Funktion lädt sauber)
- Invariant-RPC oder Test-Query am Ende (`admin_test_*_invariants`)
- Rollback-/Noop-Sicherheit (`IF NOT EXISTS`, `CREATE OR REPLACE`)
- Dedup VOR jedem neuen Unique-Index
- `REVOKE` + `GRANT EXECUTE TO service_role` für alle `SECURITY DEFINER` Funktionen

---

## D. Pipeline-Invariants (15 Regeln)

### 1. Determinismus
Jede Pipeline-Operation reproduzierbar. Keine ungeseedete Randomness, keine impliziten SQL-Defaults, keine unversionierten Prompts/Blueprints. Generation IMMER mit `blueprint_id + version` (+ optional seed).

### 2. Idempotenz (HART)
Jede Mutation idempotent:
- `ON CONFLICT DO NOTHING / UPDATE`
- Dedup VOR Unique-Index
- Aktiv-Job-Guard (`package_id + job_type` → kein zweiter aktiver Job)
- Niemals "blindes INSERT", niemals doppeltes Enqueue.

### 3. Queue-Safety
Job darf nur existieren wenn:
1. alle DAG-Prerequisites erfüllt
2. kein identischer aktiver Job
3. kein Quarantine/Paused-State
4. `run_after` respektiert
5. Lane-Isolation eingehalten

### 4. Artifact Truth > Step Status
`step.status='done'` nur wenn Ziel-Artifact materialisiert ist:
- `exam_pool` done → `exam_questions` rows existieren
- `learning_content` done → `content_hash` gesetzt
- `tutor_index` done → Index-Rows existieren
Verboten: Status ohne Materialisierung.

### 5. Fail-Fast statt Silent-Heal
`NO_PROGRESS` → Hard-Fail + Log + Eskalation in Backlog. Keine `NO_EFFECT`-Retries, keine "try again later" ohne Zustandsänderung.

### 6. Healing überdeckt Ursache nicht
Auto-Heal nur deterministische, dokumentierte Fixes. Constraint-Lockerungen NUR explizit, geloggt, reversibel.

### 7. Strict Logging-Contract
Pflichtfelder pro Log-Event:
- `action_type`, `target_id`, `result_status`, `reason_code`
- `before_state` / `after_state` bei Mutation

### 8. Schema-Truth (SSOT hart)
Frontend: KEINE Logik, KEINE Datentransformation, KEINE Entscheidungen. Alles via RPCs / SSOT-Views.

### 9. Keine impliziten Status-Strings
Statuswerte = ENUM ODER zentral dokumentiert. Verboten: freie Strings ohne Constraint.

### 10. Admin-Aktionen atomar
Admin-Op läuft vollständig oder gar nicht: cancel + reset + enqueue + log in EINER Transaktion.

### 11. Guard > Repair
Verhinderbare Fehler IMMER als Guard (DAG-Guard, Unique-Index, CHECK-Constraint, Trigger), niemals nur als Post-Repair.

### 12. Kein magisches Verhalten
Keine impliziten State-Wechsel, keine Trigger ohne Audit-Log, keine Side Effects ohne Eintrag.

### 13. Backlog ist Pflicht
Jeder unauflösbare Fehler → `heal_permanent_fix_tasks` mit `pattern_key`, `severity`, `cluster`, `recommendation`.

### 14. Testbarkeit
Jede Migration: Validierungs-Query ODER Test-RPC. Beweis statt Vertrauen.

### 15. Kein Cross-Layer-Leak
- Frontend → DB direkt: VERBOTEN
- Edge Function → Tabellen ohne Guard: VERBOTEN
- UI → interne Tabellen: VERBOTEN
- Erlaubt: RPC-Layer + geprüfte Views

---

## E. Arbeitsauftrag-Header (vor jeder SQL-Aktion)

> Arbeite wie ein Senior Database Engineer.
> 1. Liste alle Annahmen.
> 2. Prüfe sie gegen Schema/DB.
> 3. Schreibe erst dann die Migration.
> 4. Liefere danach eine Prüfquery, die beweist, dass die Migration korrekt ist.
> 5. Keine Chat-Artefakte: `COUNT()`, `SELECT INTO` ohne `*`, `RETURNING INTO` ohne `*` sind verboten.

## F. ExamFit-Spezial

Queue-, Step-, Governance- und Heal-Logik darf nur SSOT-konform verändert werden.
Keine neuen `job_type`, `step_key`, `status`, `enum`-Werte ohne Live-Prüfung.
Jeder Guard/Trigger muss loop-safe, deduped und auditierbar sein.

## G. Bonus-Direktive: "System denkt wie Prüfer"

Optimierung: Prüfungsrelevanz, Fehlervermeidung, IHK-Fallen.
NICHT: Content-Menge, Vollständigkeit, "schöne Antworten".
