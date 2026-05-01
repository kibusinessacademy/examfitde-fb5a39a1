# ExamFit System Rules

> **Status:** Verbindlich. CI-erzwungen via `.github/workflows/sql-discipline-guard.yml`.
> **Memory-Mirror:** `mem://architektur/ops/system-rules-v1`
> **Letzte Revision:** 2026-05-01

---

## 1. Grundprinzip

ExamFit ist kein Content-CMS, sondern ein prüfungslogisches Lernsystem.

Alle technischen Entscheidungen müssen folgende Priorität respektieren:

1. SSOT
2. Prüfungslogik
3. Didaktische Qualität
4. Reproduzierbarkeit
5. Automatisierung
6. UI-Komfort

Frontend darf niemals Systemlogik ersetzen.

---

## 2. SSOT-Regel

Es gibt immer genau eine Quelle der Wahrheit.

**Verboten:**
- Shadow-State im Frontend
- doppelte Business-Logik
- direkte Tabellenreads im Client
- freie Statusstrings
- manuelle Workarounds ohne Audit

**Pflicht:**
- Views/RPCs als Zugriffsschicht
- zentrale Statusdefinitionen
- jede Mutation über geprüfte Funktionen
- jede Wahrheit versionieren

---

## 3. Artifact Truth > Step Status

Ein Step gilt nur dann als `done`, wenn das Ziel-Artifact existiert.

**Beispiele:**
- `generate_exam_pool` done → `exam_questions` existieren
- `generate_learning_content` done → `content_hash` gesetzt
- `generate_blueprint_variants` done → Varianten existieren
- `build_ai_tutor_index` done → Index-Artefakte existieren
- `generate_oral_exam` done → Oral-Fragen existieren

Status allein ist niemals Beweis.

---

## 4. Idempotenz-Regel

Jede Mutation muss mehrfach ausführbar sein, ohne Schaden zu verursachen.

**Pflicht:**
- `ON CONFLICT`
- aktive Job-Deduplication
- dedupe vor Unique Index
- keine mehrfachen Side Effects
- Logs nur dedupliziert

**Verboten:**
- blindes `INSERT`
- mehrfaches Enqueue ohne Guard
- Retry ohne Zustandsänderung
- unkontrollierte Trigger-Loops

---

## 5. Queue-Safety

Ein Job darf nur entstehen, wenn:

1. alle DAG-Prerequisites erfüllt sind
2. kein identischer aktiver Job existiert
3. kein Quarantine-/Paused-State aktiv ist
4. `run_after` respektiert wird
5. lane isolation eingehalten wird

Aktive Jobs sind:

```sql
status IN ('pending','queued','processing')
```

Job-Dedup erfolgt mindestens über:

```
package_id + job_type + mode
```

---

## 6. DAG-Regel

DAG-Prerequisites sind hart.

**Verboten:**
- Downstream-Jobs ohne erfüllte Upstream-Steps
- Governance-Steps durch generische Healer finalisieren
- Step-Reihenfolge im Frontend entscheiden

**Pflicht:**
- DAG Guard
- auditierbarer Block
- Loop Counter
- deduplizierte Logs

---

## 7. Governance-Isolation

Governance-Steps dürfen nur durch ihre eigene Edge Function finalisiert werden.

**Governance-Steps:**
- `run_integrity_check`
- `quality_council`
- `auto_publish`

**Verboten:**
- generische Auto-Healer setzen Governance-Steps auf done
- direkte Enqueue-Bypasses
- Phantom-Done ohne `meta.executed=true`

---

## 8. Fail-Fast-Regel

Wenn ein Prozess keine Wirkung hat, muss er stoppen.

**Pflicht:**
- `NO_EFFECT` → kein Retry
- `NO_PROGRESS` → Eskalation
- `MATERIALIZATION_BLOCKED` → cancel statt retry-loop
- `REPAIR_EXHAUSTED` → Permanent-Fix-Task

**Verboten:**
- endlose Retries
- stille Fehler
- „später nochmal versuchen" ohne neue Ursache

---

## 9. Auto-Heal-Regel

Auto-Heal darf nur bekannte, deterministische Fixes ausführen.

**Auto-Heal darf:**
- fehlende Jobs nach DAG-Regel enqueuen
- stale locks lösen
- blockierte bekannte Zustände resetten
- definierte Repair-Jobs starten

**Auto-Heal darf nicht:**
- Qualitätsgrenzen heimlich senken
- Content erfinden
- Daten verschlechtern
- Ursachen kaschieren
- Governance-Steps finalisieren

---

## 10. Permanent-Fix-Backlog

Jeder nicht automatisch lösbare Fehler muss persistent dokumentiert werden.

**Pflichtfelder:**
- `pattern_key`
- `cluster`
- `package_id`
- `priority`
- `title`
- `description`
- `recommendation`
- `status`

Backlog-Dedup ist Pflicht.

---

## 11. SQL-Regeln

**Vor jeder SQL-Migration ZWINGEND (Schema-Realitäts-Check):**

1. **Tatsächliche Spaltenstruktur prüfen** — `information_schema.columns` oder `\d table` gegen die Live-DB. Nie aus Erinnerung, nie aus `types.ts`, nie aus älteren Migrationen ableiten.
2. **Exakte Spaltennamen & Typen verifizieren** — inkl. Casing, Singular/Plural, `_id` vs `id`, NULLability, Default. Kein „heißt bestimmt so".
3. **Enum-/Check-Constraints prüfen** — `pg_enum`, `information_schema.check_constraints`. Nur existierende Werte verwenden.
4. **Existierende Duplikate / Unique-Konflikte prüfen** — vor jedem `UNIQUE`-Index oder `ON CONFLICT`.
5. **Echte `job_type`, `step_key`, `status`, `action_type` prüfen** — gegen Live-Enums und Registry-Tabellen, nie raten.
6. **Mismatch-Verbot** — Bei jeder Abweichung zwischen Annahme und DB-Realität: STOPP, dokumentieren, neu planen. Niemals „passt schon" annehmen.
7. **Schema-Drift-Verbot** — Keine parallelen Wahrheiten (z. B. Spalte heißt in einer Migration `price_cents`, in einer anderen `amount_cents`). Drift wird sofort konsolidiert, nicht nebenher geduldet.

**Verboten:**

```
COUNT()
SELECT INTO ohne *
RETURNING INTO ohne *
freie Statuswerte ohne Constraint-Prüfung
SECURITY DEFINER ohne REVOKE/GRANT
GRANT SELECT ON admin_view TO authenticated
```

**Pflicht:**

```
COUNT(*)
SELECT * INTO ...
RETURNING * INTO ...
REVOKE ALL FROM PUBLIC
Admin-RPC mit has_role(auth.uid(),'admin')
```

**Pre-Deploy-Befehl:**
```bash
node scripts/guards/sql-discipline-guard.mjs
```

---

## 12. Security-Regel

Admin-Daten dürfen nie direkt an `authenticated` freigegeben werden.

**Verboten:**
- Admin-Views direkt an `authenticated`
- interne Tabellen im Frontend
- Service-Role-Logik im Client
- Secrets im Repo

**Erlaubt:**
- Admin-RPC mit `has_role`
- service_role-only interne Views
- RLS-konforme Public Views

---

## 13. Logging-Contract

Jede relevante Mutation muss loggen:

- `action_type`
- `trigger_source`
- `target_type`
- `target_id`
- `result_status`
- `reason_code`
- `before_state`
- `after_state`
- `metadata`

Logs müssen dedupliziert sein.

---

## 14. AI-Regel

AI darf keine neue Wahrheit erzeugen.

**AI darf:**
- Vorschläge machen
- Varianten aus Blueprints ableiten
- Feedback erklären
- Lernpfade empfehlen

**AI darf nicht:**
- Curriculum verändern
- Prüfungslogik erfinden
- Fragen ohne Blueprint erzeugen
- Tutor-Antworten ohne SSOT-Kontext geben

---

## 15. Blueprint-Regel

Blueprints sind SSOT für Prüfungsfragen.

**Jede Frage muss referenzieren:**
- `blueprint_id`
- `competency_id`
- `learning_field_id`
- Schwierigkeit
- Prüfungsrelevanz
- typische Fehler

Keine freie Einzelgenerierung.

---

## 16. Prüfungssystem-Regel

ExamFit optimiert auf Prüfungsreife, nicht auf Content-Menge.

**Pflichtmetriken:**
- Frageanzahl
- LF-Coverage
- Kompetenz-Coverage
- Bloom-Verteilung
- Schwierigkeitsverteilung
- Kontext-Isolation
- Prüfungsrelevanz

---

## 17. Frontend-Regel

Frontend ist Anzeige- und Interaktionsschicht.

**Frontend darf nicht:**
- Business-Regeln entscheiden
- Pipeline-Zustände berechnen
- Tabellen direkt lesen
- Status ableiten
- Repairs selbst orchestrieren

**Frontend nutzt:**
- RPCs
- geprüfte Views
- typed Services
- klare Admin-Actions

---

## 18. Testpflicht

Jede Migration braucht mindestens eine Prüfquery oder Test-RPC.

**Pflichttests:**
- Syntax
- Security-Grants
- Idempotenz
- keine Duplikate
- keine aktiven Jobs in Paused-State
- Artifact Truth
- DAG-Konsistenz

---

## 19. Lovable-Regel

Lovable muss vor jeder technischen Änderung so arbeiten:

1. Annahmen auflisten
2. **Schema-Realitäts-Check zuerst** — tatsächliche Spaltenstruktur, Spaltennamen, Typen, Enums, Constraints gegen die Live-DB prüfen (siehe Regel 11). Kein Code, keine Migration ohne diesen Schritt.
3. **Mismatches & Schema-Drifts aktiv vermeiden** — Abweichungen zwischen Annahme/Code/Memory/DB sofort melden und konsolidieren, nicht überschreiben.
4. DB-/Code-Realität insgesamt prüfen
5. Patch minimal bauen
6. Guards ergänzen
7. Tests/Prüfqueries liefern
8. keine erfundenen Tabellen, Spalten, RPCs oder Statuswerte

---

## 21. Identity & Naming Regel (Canonical Identity Contract)

Jede Entität braucht **drei Identitäten**:
- **UUID** = `*_id` für Maschinen/Joins
- **Stabiler Key** = `*_key` / `*_type` für Systemlogik (immutable nach Vergabe)
- **Lesbarer Name** = `*_name` / `title` für Menschen/Admin

**Pflichtfelder pro Ebene:**

| Ebene | UUID | Key | Name | Bezug |
|---|---|---|---|---|
| Package | `id` | `package_key` (immutable) | `title` | `certification_id`, `product_id` |
| Job | `id` | `job_type` (in `ops_job_type_registry`) | `job_name` | `package_id`, `correlation_id`, `root_job_id`, `parent_job_id` |
| Step | `id` | `step_key` | `step_name` | `package_id`, `artifact_type` |

**Verboten:**
- Logs nur mit UUID ohne `*_name`
- Jobs ohne `package_id`, wenn `ops_job_type_registry.requires_package_id = true`
- Async-Jobs ohne `correlation_id` / `root_job_id`
- Freie `job_type`-Werte ohne Registry-Eintrag (Drift mit `KNOWN_JOB_TYPES` + `_shared/job-map.ts` ist verboten)
- `title` als Join-Key
- `slug` als einzige Wahrheit (slug darf sich ändern, `package_key` nicht)
- `package_key` ändern nach Vergabe (DB-Trigger `trg_guard_package_key_immutable` blockt)

**Pflicht:**
- Jeder neue `job_type` zuerst in `ops_job_type_registry` mit `job_name`, `lane`, `requires_package_id`, `is_governance` registrieren
- Producer setzen `correlation_id` und `root_job_id` beim Enqueue (Producer-Helper folgt; Phase 3 Guard ist warn-only bis 7 Tage Grace)
- Audit-Logs: `action_type`, `target_type`, `target_id`, `result_status` Pflicht; `metadata` für `package_key`/`job_name`-Snapshot

**Enforcement:** `scripts/guards/canonical-identity-contract-guard.mjs` (5 Sub-Guards, warn-only). CI: `.github/workflows/canonical-identity-guard.yml`. Hard-Block-Umstieg nach 7-Tage-Beobachtung mit Drift-Report.

---

## 22. Goldene Regel

> **Guard vor Repair.**
> **Artifact vor Status.**
> **Fail-Fast vor Retry.**
> **SSOT vor UI.**
> **Prüfungslogik vor Content.**
> **Identity vor Logs (UUID + Key + Name immer zusammen).**

---

## Permanente Projektregel (Lovable-Header)

```text
Arbeite bei ExamFit wie ein Senior Database Engineer, Pipeline Architect und IHK-Prüfungsdidaktiker.

Keine technischen Annahmen ungeprüft verwenden.
Keine SQL-Migration ohne Schema-Prüfung.
Keine neuen job_type, step_key, status oder enum-Werte ohne Live-Abgleich.
Keine UI-Logik statt SSOT.
Jede Mutation muss idempotent, auditierbar und rollback-sicher sein.
Jeder Step ist nur done, wenn das Ziel-Artifact existiert.
```

---

## Enforcement-Layer

| Layer | Datei |
|---|---|
| Live-Memory (jede Session) | `mem://architektur/ops/system-rules-v1` |
| Repo-SSOT (Menschen) | `docs/SYSTEM_RULES.md` (diese Datei) |
| Pre-Commit / Local | `node scripts/guards/sql-discipline-guard.mjs` |
| CI (Hard-Block) | `.github/workflows/sql-discipline-guard.yml` |
| Baseline (Tech-Debt) | `scripts/guards/sql-discipline-baseline.json` |

Ein Verstoß = roter PR. Keine Ausnahmen.
