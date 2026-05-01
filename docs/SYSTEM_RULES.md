# ExamFit System Rules (Production Constitution)

> **Status:** Verbindlich. CI-erzwungen via `.github/workflows/sql-discipline-guard.yml`.
> **Memory-Mirror:** `mem://architektur/ops/system-rules-v1`
> **Letzte Revision:** 2026-05-01

Diese Datei ist die **Single Source of Truth** für SQL-Disziplin, Pipeline-Invariants und Admin-Operationen. Jede Migration, jede Edge-Function, jeder Cron-Job, jede Admin-RPC muss diesen Regeln folgen.

---

## TL;DR (3 Regeln, die alles tragen)

1. **Idempotenz + Dedup überall** — keine Mutation ohne `ON CONFLICT` / Aktiv-Job-Guard / Dedup-vor-Unique.
2. **Artifact Truth statt Status** — `done` ist eine Lüge, solange das Artifact fehlt.
3. **Fail-Fast + echtes Logging** — `NO_PROGRESS` → Hard-Fail + Backlog. Keine stillen Retries.

---

## 1. SQL-Phasen-Workflow (PFLICHT)

Jede SQL-Änderung folgt **3 Phasen**:

### Phase A — Schema prüfen
```sql
-- Existiert die Spalte?
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema='public' AND table_name='heal_permanent_fix_tasks';

-- Statusfeld = enum/check/text?
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conrelid='public.heal_permanent_fix_tasks'::regclass;

-- job_type Live-Werte
SELECT DISTINCT job_type FROM job_queue ORDER BY 1;
```

### Phase B — Migration schreiben
- idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`)
- dedupe VOR Unique-Index
- `SECURITY DEFINER` IMMER mit `REVOKE FROM PUBLIC` + gezieltem `GRANT TO service_role`

### Phase C — Migration validieren
```sql
-- Invariant-RPC am Ende
SELECT * FROM admin_test_<feature>_invariants();
```

---

## 2. Verbotene SQL-Muster (CI Hard-Block)

| Verboten | Korrekt |
|---|---|
| `SELECT COUNT() INTO v_n FROM ...` | `SELECT COUNT(*) INTO v_n FROM ...` |
| `SELECT INTO v_state FROM ...` | `SELECT * INTO v_state FROM ...` |
| `INSERT ... RETURNING INTO v_row` | `INSERT ... RETURNING * INTO v_row` |
| `WHERE status='paused'` ohne ENUM/CHECK-Check | Zuerst Constraint prüfen, sonst neuer Wert via Migration |
| `'package_generate_exam_pool'` ohne DB-Abgleich | `SELECT DISTINCT job_type FROM job_queue` zuerst |
| `SECURITY DEFINER` ohne `REVOKE`/`GRANT` | `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO service_role;` |
| `GRANT SELECT ON v_admin_* TO authenticated` | RPC-Wrapper mit `has_role('admin')` |

**Pre-Deploy-Befehl:**
```bash
rg "COUNT\(\)|SELECT\s+INTO|RETURNING\s+INTO" supabase/migrations
node scripts/guards/sql-discipline-guard.mjs
```

---

## 3. Pipeline-Invariants (15 Regeln)

### 🔴 1. Determinismus
Jede Generierung basiert auf `blueprint_id + version` (optional `seed`). Keine ungeseedete Randomness.

### 🔴 2. Idempotenz
`ON CONFLICT DO NOTHING/UPDATE`, Dedup VOR Unique-Index, Aktiv-Job-Guard pro `(package_id, job_type)`.

### 🔴 3. Queue-Safety
Job nur enqueuen wenn: DAG-Prereqs ✓, kein identischer aktiver Job ✓, kein Quarantine/Paused ✓, `run_after` ✓, Lane-Isolation ✓.

### 🔴 4. Artifact Truth > Step Status
`step.status='done'` ⇔ Artifact materialisiert. Trigger `trg_guard_no_phantom_steps_on_published` zeigt das Muster.

### 🔴 5. Fail-Fast
`NO_PROGRESS` → Hard-Fail + Backlog. Kein "try again later" ohne Zustandsänderung.

### 🔴 6. Healing überdeckt Ursache nicht
Auto-Heal: nur deterministische Fixes. Constraint-Relax NUR explizit + geloggt + reversibel.

### 🔴 7. Strict Logging-Contract
Pflichtfelder: `action_type`, `target_id`, `result_status`, `reason_code`, `before_state`/`after_state`.

### 🔴 8. Schema-Truth (SSOT)
Frontend = reines View-Layer. Logik/Transformation/Entscheidungen → DB (RPC/View).

### 🔴 9. Keine freien Status-Strings
ENUM oder zentral dokumentierter Wert. Sonst Ghost-Bugs.

### 🔴 10. Admin-Aktionen atomar
Restart = cancel + reset + enqueue + log in EINER Transaktion.

### 🔴 11. Guard > Repair
DAG-Guard > Retry. Unique-Index > Dedup-Script. CHECK > Post-Validation.

### 🔴 12. Kein magisches Verhalten
Keine impliziten State-Wechsel, keine Trigger ohne Audit-Eintrag.

### 🔴 13. Backlog ist Pflicht
Unauflösbare Fehler → `heal_permanent_fix_tasks(pattern_key, severity, cluster, recommendation)`.

### 🔴 14. Testbarkeit
Jede Migration: Validierungs-Query oder Test-RPC.

### 🔴 15. Kein Cross-Layer-Leak
RPC-Layer + geprüfte Views = einzig erlaubte Tür.

---

## 4. Arbeitsauftrag-Header

Vor JEDER SQL-Aktion in Lovable / Cursor / Claude / GPT:

```
Arbeite wie ein Senior Database Engineer.
1. Liste alle Annahmen.
2. Prüfe sie gegen Schema/DB.
3. Schreibe erst dann die Migration.
4. Liefere danach eine Prüfquery.
5. COUNT(), SELECT INTO ohne *, RETURNING INTO ohne * sind verboten.
```

---

## 5. ExamFit-Spezial

- Queue-, Step-, Governance- und Heal-Logik **nur SSOT-konform**.
- Keine neuen `job_type`, `step_key`, `status`, `enum` ohne Live-Prüfung gegen Prod-DB.
- Jeder Guard/Trigger: loop-safe, deduped, auditierbar.
- "System denkt wie Prüfer" — Optimierung auf Prüfungsrelevanz, nicht Content-Menge.

---

## 6. Enforcement

| Layer | Tool |
|---|---|
| Memory (Live-Prompt) | `mem://architektur/ops/system-rules-v1` |
| Repo-SSOT | `docs/SYSTEM_RULES.md` (diese Datei) |
| Pre-Commit / Local | `node scripts/guards/sql-discipline-guard.mjs` |
| CI (Hard-Block) | `.github/workflows/sql-discipline-guard.yml` |

Ein Verstoß = roter PR. Keine Ausnahmen.
