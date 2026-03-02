# Single Source of Truth (SSOT) Dokumentation

## 0️⃣ Leitprinzip

**Ein Datum, eine Quelle, eine Wahrheit.**

- SSOT gilt **ausschließlich für Persistenz** – niemals für Darstellung
- Alles, was nicht persistiert wird (Slug, Titel, UI-Label), ist **kein SSOT**
- Wenn es neu berechnet werden kann → kein SSOT

---

## 1️⃣ Curriculum – Primäre SSOT

**Autoritative Quelle:** `curricula` → `learning_fields` → `competencies`

```
curricula (FROZEN)
  └── learning_fields
        └── competencies
```

### Status-Lifecycle (hart)

```
draft → extracting → normalizing → frozen
```

### HARTREGELN

| Regel | Beschreibung |
|-------|--------------|
| ❌ | Änderungen nach `frozen` **verboten** |
| ✅ | Referenzen **ausschließlich über UUID** |
| ✅ | `frozen_at` ist **Audit-relevant** |
| ✅ | Alle Ableitungen (Kurse, Fragen, Jobs) müssen auf `frozen` zeigen |

### Identifier-Regeln (kritisch)

| Feld | Bedeutung | Darf Logik steuern |
|------|-----------|-------------------|
| `curriculum_id` (UUID) | **Wahrheit** | ✅ Ja |
| `curriculum_code` | stabiler Identifier | ⚠️ nur Lookup |
| `slug` | UI / SEO | ❌ **niemals** |

> 🔒 **Slug ist explizit KEIN Bestandteil der Geschäftslogik.**

---

## 2️⃣ Kurse, Module, Lessons – Sekundäre Ableitung

**Quelle:** `courses` → `modules` → `lessons`

```
courses
  └── modules (1 pro learning_field)
        └── lessons (5 pro competency)
```

### Zwangsregeln

| Regel | Beschreibung |
|-------|--------------|
| ✅ | Jeder Kurs → genau 1 `curriculum_id` |
| ✅ | Module → `learning_field_id` |
| ✅ | Lessons → `competency_id` |
| ❌ | Curriculum-Daten werden **niemals kopiert** |

### 5-Schritte-Didaktik (fix)

```typescript
const LESSON_STEPS = [
  'einstieg',
  'verstehen',
  'anwenden',
  'wiederholen',
  'mini_check'
] as const;
```

> ❌ **Andere Steps = Architekturbruch**

---

## 3️⃣ Prüfungsfragen – Kontrollierte Ableitung

**Quelle:** `exam_questions`

### Regeln

| Feld | Pflicht |
|------|---------|
| `curriculum_id` | ✅ Pflicht |
| `learning_field_id` | ⚠️ Optional |
| `competency_id` | ⚠️ Optional |

### Status-Workflow

```
draft → review → approved | rejected
```

> ✅ Nur `approved` Fragen erscheinen im Prüfungstrainer

### Schwierigkeitsgrade (SSOT)

```typescript
const DIFFICULTIES = ['easy', 'medium', 'hard', 'very_hard'] as const;
```

---

## 4️⃣ Job-System – Eigene SSOT-Ebene

**Quelle:** `job_queue` (konzeptionell) / Edge Functions (aktuell)

> Jobs sind keine Logik, sondern **Ausführung von Wahrheit**.

### HARTE JOB-REGELN

| Regel | Beschreibung |
|-------|--------------|
| ❌ | Jobs dürfen **nichts erraten** |
| ❌ | Jobs dürfen **keine Slugs auflösen** |
| ✅ | Jobs müssen **vollständige Payloads** haben |
| ✅ | Fehlende Pflichtfelder → **Hard-Fail** |

### Verbindlicher Job-Contract

```typescript
interface JobPayload {
  curriculum_id: string;        // UUID – PFLICHT
  curriculum_code?: string;     // nur für Logs
  learning_field_id?: string;   // UUID
  competency_id?: string;       // UUID
}
```

### VERBOTEN in Job-Payloads

```typescript
// ❌ NIEMALS VERWENDEN
slug
profession_slug
curriculum.slug
// ❌ Joins über Text-Felder
```

---

## 5️⃣ User, Rollen, Auth – Externe SSOT

**Quelle:** Supabase Auth (respektiert)

```
auth.users (managed by Supabase)
  └── user_roles
  └── profiles
```

### Regeln

| Regel | Beschreibung |
|-------|--------------|
| ❌ | `auth.users` **niemals direkt anfassen** |
| ✅ | Rollen nur **serverseitig** prüfen |
| ✅ | `profiles` = reine UI-Daten |

### Rollen (SSOT)

```typescript
const ROLES = ['admin', 'teacher', 'learner'] as const;
```

---

## 6️⃣ Lernfortschritt

**Quelle:** `course_enrollments` + `learning_progress` + `exam_attempts`

### Regeln

| Regel | Beschreibung |
|-------|--------------|
| ✅ | `course_enrollments`: User → Kurs Zuordnung |
| ✅ | `learning_progress`: Fortschritt pro Lesson |
| ✅ | `exam_attempts`: Prüfungsversuche mit Antworten |
| ❌ | Fortschritt referenziert **nie Curriculum direkt** |

---

## 7️⃣ Was explizit KEIN SSOT ist

```markdown
❌ slug
❌ Titel
❌ Anzeigenamen
❌ URL-Pfade
❌ Logs
❌ Client-State
❌ LocalStorage
❌ abgeleitete Zähler
❌ berechnete Felder
```

> **Regel:** Wenn es neu berechnet werden kann → kein SSOT.

---

## 8️⃣ Anti-Patterns (VERBOTEN)

| Anti-Pattern | Grund |
|--------------|-------|
| ❌ Curriculum nach Freeze ändern | Bricht Audit-Trail |
| ❌ `slug` / Text als Join | Instabil, fehleranfällig |
| ❌ IDs aus Namen ableiten | Fragile Logik |
| ❌ Curriculum-Daten duplizieren | Verletzt SSOT |
| ❌ Jobs mit unvollständigem Payload | Hard-Fail-Regel |
| ❌ Logik im Frontend | Architekturbruch |
| ❌ Hardcoded IDs statt Referenzen | Wartungs-Albtraum |

---

## Datenfluss-Diagramm

```
┌──────────────────┐
│  PDF/Dokument    │  ← Upload
└────────┬─────────┘
         ▼
┌──────────────────┐
│ extract-curriculum│  ← AI-Extraktion (Edge Function)
└────────┬─────────┘
         ▼
┌──────────────────┐
│  curricula       │  ← PRIMÄRE SSOT (nach Freeze)
│  (frozen)        │
└────────┬─────────┘
         │
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌───────┐  ┌───────────┐  ┌──────────┐
│courses│  │exam_questions│  │job_queue│
│(2°)   │  │(3°)         │  │(Executor)│
└───────┘  └───────────┘  └──────────┘
```

---

## 9️⃣ Ops Guard – Runner & Lease Integrity (SSOT)

### Lease-Regel (DB-Trigger enforced)

| Regel | Enforcement |
|-------|-------------|
| ✅ Lease darf **nur für `building` Packages** existieren | `trg_guard_package_leases_building_only` (BEFORE INSERT/UPDATE) |
| ❌ Lease für non-building → `RAISE EXCEPTION` | Prefix: `OPS_GUARD:PACKAGE_LEASES_NON_BUILDING:` |

### Claim Eligibility

| Regel | Beschreibung |
|-------|--------------|
| ✅ | Nur `claim_pending_jobs_v4` ist SSOT für Job-Claims |
| ✅ | v1/v2/v3/current → Wrapper mit Telemetry (`LEGACY_RPC_USED` Alert) |
| ❌ | Legacy RPCs **niemals direkt nutzen** |

### Integrity Monitoring

```
ops_runner_integrity          → Zähler-View (Snapshot)
ops_runner_integrity_details  → Detail-View (Debugging)
ops_run_integrity_checks()    → RPC: prüft + schreibt Alerts
```

**Metriken:**
- `orphan_leases` — Leases für non-building (sollte immer 0, Trigger verhindert)
- `pending_non_building` / `processing_non_building` — Jobs ohne building-Package
- `stuck_processing_10m` — Zombie-Jobs
- `dangling_jobs_no_package` — Jobs ohne existierendes Package
- `leases_active_no_work` — Idle Leases (building, keine Jobs, >10min — Alert ab ≥3 info, ≥10 warn)

### Formale Invarianten

> **Lease-Invariante:** Es darf keine aktive Lease existieren, wenn `course_packages.status ≠ building`. *(DB-Trigger enforced)*

> **Claim-Invariante:** Ein pending Job mit `package_id` darf nur geclaimed werden, wenn das Package `building` ist UND eine gültige Lease existiert. *(`claim_pending_jobs_v4`)*

### Remediation-Hierarchie

```
1. DB-Trigger (un-umgehbar)
2. Claim Eligibility (v4)
3. Legacy Wrapper + Telemetry
4. pg_cron Safety-Net (cancel non-building, integrity checks)
5. GitHub Action (Nightly Alert)
```

---

## Änderungs-Protokoll

| Datum      | Änderung                                    | Autor  |
|------------|---------------------------------------------|--------|
| 2025-02-07 | Initiale SSOT-Dokumentation                 | System |
| 2025-02-07 | Überarbeitung: Job-System, Identifier-Regeln, Anti-Patterns | System |
| 2026-02-27 | Ops Guard Pack: Lease-Trigger, Legacy-Wrapper, Integrity-Monitoring | System |
