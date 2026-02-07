# JOB_CONTRACTS.md

**Single Source of Truth für alle Jobs & Worker**

---

## Zweck dieses Dokuments

Dieses Dokument definiert **verbindliche Verträge** für alle Jobs, Worker, Edge Functions und AI-Agenten im System.

> **Kein Job darf ausgeführt werden, wenn er diesen Contract verletzt.**

### Ziel

- ✅ Keine Fehlerschleifen
- ✅ Keine Slug-Abhängigkeiten
- ✅ Keine implizite Logik
- ✅ Volle Reproduzierbarkeit & Audit-Fähigkeit

---

## Grundprinzip

> **Jobs führen Wahrheit aus – sie erzeugen keine.**

| Regel | Beschreibung |
|-------|--------------|
| ❌ | Jobs **entscheiden nichts** |
| ❌ | Jobs **raten nichts** |
| ❌ | Jobs **leiten nichts aus Texten ab** |

### 🔐 Pflichtregel (HART)

**Jeder Job MUSS alle benötigten UUIDs explizit im Payload enthalten.**

> Fehlt eine UUID → Job **FAILT SOFORT**

---

## 1️⃣ Zentrale Job-Struktur (SSOT)

### Pflichtfelder (job_queue)

```typescript
interface JobRecord {
  id: UUID;
  job_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  payload: JobPayload;
  attempts: number;
  max_attempts: number;
  run_after: timestamp;
}
```

---

## 2️⃣ Verbindlicher JobPayload-Contract

```typescript
interface JobPayload {
  curriculum_id: UUID;              // 🔴 PFLICHT
  learning_field_id?: UUID;         // optional
  competency_id?: UUID;             // optional

  // rein informativ (Logs / Debug / UI)
  curriculum_code?: string;
  job_version?: string;
}
```

### ❌ Verbotene Felder im Payload

Diese Felder **dürfen nicht existieren**:

```typescript
// ❌ VERBOTEN - niemals in Payloads verwenden
slug
profession_slug
curriculum.slug
curriculumCode  // als Entscheidungsgrundlage
name
title
```

> Sie dürfen höchstens in **Logs** erscheinen – **nie in Logik**.

---

## 3️⃣ Erlaubte Job-Typen

| Job-Type | Zweck | UUID Pflicht |
|----------|-------|--------------|
| `extract_curriculum` | KI-Extraktion aus Dokument | `curriculum_id` |
| `generate_course` | Kurs mit Modulen/Lessons erstellen | `curriculum_id` |
| `generate_questions` | Prüfungsfragen generieren | `curriculum_id`, `competency_id` |
| `seed_exam_questions` | Bulk-Generierung Prüfungsfragen | `curriculum_id` |
| `enrich_exam_solutions` | Musterlösungen hinzufügen | `curriculum_id` |
| `upgrade_minichecks_v1` | Didaktische Upgrades | `curriculum_id` |
| `*_smoke` | Systemtests | `curriculum_id` |

---

## 4️⃣ Worker-Pflichten (KRITISCH)

Jeder Worker **MUSS VOR START** prüfen:

```typescript
// Pflicht-Validierung am Anfang jedes Workers
function validatePayload(payload: unknown): asserts payload is JobPayload {
  if (!payload || typeof payload !== 'object') {
    throw new SSOTViolationError('Invalid payload structure');
  }
  
  if (!('curriculum_id' in payload) || !payload.curriculum_id) {
    throw new SSOTViolationError('Missing curriculum_id (SSOT violation)');
  }
  
  // UUID-Format validieren
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(payload.curriculum_id as string)) {
    throw new SSOTViolationError('Invalid curriculum_id format (must be UUID)');
  }
}
```

### Wenn die Prüfung fehlschlägt:

```typescript
fail_job({
  reason: 'INVALID_PAYLOAD',
  message: 'Missing curriculum_id (SSOT violation)'
});
```

| Aktion | Erlaubt |
|--------|---------|
| ❌ Retry | Nein |
| ❌ Fallback | Nein |
| ❌ Slug-Lookup | Nein |

---

## 5️⃣ Lookup-Regeln (einzige erlaubte Form)

### ✅ Erlaubt (einmalig, vor Job-Erstellung)

```sql
-- Lookup VOR Job-Erstellung (nicht im Worker!)
SELECT id FROM curricula WHERE code = :curriculum_code;
```

➡ Ergebnis wird **fest in den Job geschrieben**.

### ❌ Verboten (IMMER)

```sql
-- ❌ NIEMALS in Jobs/Workers verwenden
WHERE curricula.slug = ...
WHERE curricula.name = ...
WHERE profession_slug = ...
```

---

## 6️⃣ Retry-Regeln

| Fehler | Retry erlaubt |
|--------|---------------|
| Netzwerk / Timeout | ✅ Ja |
| LLM Rate Limit | ✅ Ja |
| AI Gateway Error | ✅ Ja |
| Payload fehlt | ❌ Nein |
| SSOT-Verstoß | ❌ Nein |
| Ungültige UUID | ❌ Nein |
| Curriculum nicht gefunden | ❌ Nein |

---

## 7️⃣ Logging-Standard

```json
{
  "ts": "2026-02-07T10:12:00Z",
  "level": "info | warn | error",
  "msg": "string",
  "job_id": "uuid",
  "job_type": "string",
  "curriculum_id": "uuid",
  "meta": {}
}
```

> **Logs sind niemals Entscheidungsgrundlage.**

---

## 8️⃣ Anti-Patterns (JOB-EBENE)

| Anti-Pattern | Warum verboten |
|--------------|----------------|
| ❌ Slugs auflösen | Instabil, nicht-deterministisch |
| ❌ Curriculum anhand Text bestimmen | Fehleranfällig |
| ❌ Fehlende UUIDs tolerieren | SSOT-Verletzung |
| ❌ Logik im Worker verstecken | Nicht auditierbar |
| ❌ Payload „reparieren" | Maskiert Fehler |
| ❌ Jobs automatisch neu schreiben | Unkontrolliert |

---

## 9️⃣ Durchsetzung

### a) DB-Check (optional, aber empfohlen)

```sql
-- CHECK Constraint für job_queue (wenn implementiert)
ALTER TABLE job_queue ADD CONSTRAINT payload_has_curriculum_id 
  CHECK (payload ? 'curriculum_id');
```

### b) Worker-Guard (PFLICHT)

```typescript
// Am Anfang jeder Edge Function
export function guardPayload(payload: unknown): JobPayload {
  if (!payload?.curriculum_id) {
    throw new Error('SSOT_VIOLATION: Missing curriculum_id');
  }
  return payload as JobPayload;
}
```

### c) TypeScript Compile-Time Safety

```typescript
// Typen erzwingen Pflichtfelder
type StrictJobPayload = {
  curriculum_id: string;  // Required, no optional
  learning_field_id?: string;
  competency_id?: string;
};
```

---

## 🧠 Merksatz (für alle Agenten)

> **Wenn ein Job nicht exakt weiß, auf welches Curriculum er sich bezieht, darf er nicht laufen.**

---

## Status

| Feld | Wert |
|------|------|
| Version | v1.0 |
| Gültig ab | sofort |
| Bindend für | alle Jobs & Worker |
| Änderbar | ❌ nur per Architekturentscheidung |

---

## Änderungs-Protokoll

| Datum | Änderung | Autor |
|-------|----------|-------|
| 2025-02-07 | Initiale Contract-Dokumentation | System |
