# SSOT: Validate Exam Pool Guard

Kanonische Referenz für Guard-States, Reason-Codes und Meta-Felder des `validate_exam_pool`-Steps.

> **Verbindlichkeit**: Dieses Dokument ist die Single Source of Truth. Abweichende Feldnamen oder Codes in Code/UI sind Bugs.

---

## 1. Kanonische Felder in `package_steps.meta`

### Geschützte Felder (Meta-Contract-Guard)

| Feld | Typ | Schreiber | Beschreibung |
|------|-----|-----------|--------------|
| `guard_state` | `string` | Validator | Aktueller Guard-Zustand (`healthy` \| `recovering` \| `soft_stalled` \| `hard_stalled`) |
| `stall_reason_code` | `string` | Validator, Healer | Maschinenlesbarer Grund für den aktuellen Zustand |
| `consecutive_no_progress` | `number` | Validator | Anzahl aufeinanderfolgender Zyklen ohne messbaren Fortschritt |
| `last_progress_delta` | `object` | Validator | Delta-Objekt des letzten Snapshot-Vergleichs |
| `last_validate_completed_at` | `string` | Validator | ISO-Timestamp des letzten abgeschlossenen Validierungslaufs |
| `last_progress_at` | `string` | Validator | ISO-Timestamp des letzten erkannten Fortschritts |
| `last_guard_action` | `string` | Validator, Healer | Letzte ausgeführte Guard-Aktion (z. B. `enqueue_repair`, `block`) |
| `grace_until` | `string` | Healer, Repair | ISO-Timestamp, bis wann Recovery-Grace aktiv ist |
| `last_repair_completed_at` | `string` | Repair | ISO-Timestamp des letzten abgeschlossenen Repair-Laufs |

### Verbotene Alias-Namen

Diese Feldnamen dürfen **nicht** verwendet werden. Vorkommen im Code sind zu bereinigen:

| Verboten | Kanonisch |
|----------|-----------|
| `last_reason_code` | → `stall_reason_code` |
| `last_guard_state` | → `guard_state` |
| `reason_code` (standalone) | → `stall_reason_code` |
| `no_progress_count` | → `consecutive_no_progress` |
| `progress_delta` | → `last_progress_delta` |
| `repair_completed_at` | → `last_repair_completed_at` |

### Observability-Felder (vom Meta-Contract-Trigger geschrieben)

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `meta_contract_healed_at` | `string` | Timestamp der letzten Auto-Heilung |
| `meta_contract_healed_keys` | `string[]` | Welche Keys wiederhergestellt wurden |
| `meta_contract_heal_count` | `number` | Kumulativer Zähler der Heilungs-Events |

---

## 2. Guard-States

```
healthy ──► soft_stalled ──► recovering ──► healthy
                │                              ▲
                │         (grace abgelaufen)    │
                ▼                              │
           hard_stalled ───────────────────────┘
                              (manueller Reset)
```

| State | Bedeutung | Übergang aus | Übergang nach |
|-------|-----------|-------------|---------------|
| `healthy` | Fortschritt sichtbar: `delta_approved > 0` ODER `delta_unresolved < 0` ODER `delta_missing_lf < 0` | `recovering`, Initialer Zustand | `soft_stalled` |
| `soft_stalled` | Kein Fortschritt über ≥2 Zyklen, Recovery noch möglich | `healthy` | `recovering` (Repair enqueued), `hard_stalled` |
| `recovering` | Repair aktiv oder Grace-Period läuft | `soft_stalled` | `healthy` (Fortschritt), `hard_stalled` (Grace abgelaufen) |
| `hard_stalled` | Echter Stillstand nach Repair-Zyklen + Grace abgelaufen | `soft_stalled`, `recovering` | `healthy` (nur manueller Reset) |

---

## 3. Reason-Codes (`stall_reason_code`)

| Code | Bedeutung | Typischer Auslöser | Erwartete Aktion | UI-Label |
|------|-----------|-------------------|------------------|----------|
| `VALIDATE_EXAM_POOL_SOFT_STALL` | Kein Fortschritt, Repair noch nicht versucht | Mehrere Validierungsläufe ohne Delta | Repair automatisch enqueued | ⚠️ Soft-Stall |
| `VALIDATE_EXAM_POOL_TRUE_STALL` | Echter Stillstand nach Repair-Zyklen | Grace abgelaufen, kein Delta nach Repair | **Block** — manuelle Intervention | 🔴 Hard-Stall |
| `NO_PROGRESS_AFTER_REPAIR` | Repair lief, aber kein messbares Delta | Repair hat keine neuen Approvals / keine Flags bereinigt | Prüfung durch Ops: Warum schlägt Repair fehl? | ⚠️ Repair wirkungslos |
| `REPAIR_RUNNING_AWAITING_DELTA` | Aktive Jobs/Lease vorhanden, Delta steht aus | Repair oder Fill-Job läuft noch | Warten — kein Eingriff nötig | 🔄 Repair läuft |
| `RECENT_HEAL_GRACE_ACTIVE` | Grace-Period nach Repair noch aktiv | Healer hat Grace-Window gesetzt | Warten bis `grace_until` abgelaufen | ⏳ Grace aktiv |

### Erweiterungsregel

Neue Reason-Codes **müssen** in diesem Dokument eingetragen werden, bevor sie im Code verwendet werden. Format: `SCOPE_DESCRIPTION` in UPPER_SNAKE_CASE.

---

## 4. Writer-Matrix

Welcher Systemteil darf welche Meta-Felder schreiben:

| Feld | Validator | Repair | Healer | job-fail |
|------|:---------:|:------:|:------:|:--------:|
| `guard_state` | ✅ | ❌ | ✅¹ | ❌ |
| `stall_reason_code` | ✅ | ❌ | ✅¹ | ❌ |
| `consecutive_no_progress` | ✅ | ❌ | ❌ | ❌ |
| `last_progress_delta` | ✅ | ❌ | ❌ | ❌ |
| `last_validate_completed_at` | ✅ | ❌ | ❌ | ❌ |
| `last_progress_at` | ✅ | ❌ | ❌ | ❌ |
| `last_guard_action` | ✅ | ❌ | ✅ | ❌ |
| `grace_until` | ❌ | ✅ | ✅ | ❌ |
| `last_repair_completed_at` | ❌ | ✅ | ❌ | ❌ |
| `error` / `last_error` | ❌ | ❌ | ❌ | ✅ |

¹ Healer darf `guard_state` nur bei expliziter Klassifikation setzen (False-Positive-Heal).

### Verbotene Schreibmuster

```typescript
// ❌ VERBOTEN — roher Overwrite
await supabase.from('package_steps').update({ meta: { guard_state: 'healthy' } })

// ✅ KORREKT — Merge-Helper
await mergePackageStepMeta(supabase, stepId, { guard_state: 'healthy' })
```

---

## 5. Merge-Regeln

### Primärmechanismus: `mergePackageStepMeta()`

```
1. SELECT meta FROM package_steps WHERE id = ?
2. merged = { ...existing_meta, ...new_fields }
3. UPDATE package_steps SET meta = merged WHERE id = ?
```

**Pfad**: `supabase/functions/_shared/merge-step-meta.ts`

### Safety-Net: DB-Trigger `trg_guard_package_step_meta_contract`

- Greift bei **jedem** UPDATE auf `package_steps`
- Nur aktiv für Steps mit `step_key IN ('validate_exam_pool', 'repair_exam_pool_quality')`
- Auto-Merge: Wenn geschützte Keys in `OLD.meta` vorhanden aber in `NEW.meta` fehlend → zurückmergen
- Protokolliert Heilungen via `meta_contract_healed_*`-Felder
- **Kein Blocker** — der Trigger heilt still, blockiert nicht

### Rangfolge

1. **Code**: Immer `mergePackageStepMeta()` verwenden
2. **Trigger**: Fängt vergessene rohe Writes ab (Defense-in-Depth)
3. **CI-Guard** *(geplant)*: Statische Analyse gegen rohe `meta`-Overwrites

---

## 6. UI-/Ops-Mapping

### Guard-State → Farbe (Leitstelle)

| `guard_state` | Farbe | Badge | Operator-Aktion |
|---------------|-------|-------|-----------------|
| `healthy` | 🟢 Grün | `Healthy` | Keine — System arbeitet normal |
| `recovering` | 🔵 Blau | `Recovering` | Beobachten — Repair läuft |
| `soft_stalled` | 🟡 Gelb | `Soft-Stall` | Prüfen ob Repair enqueued wurde |
| `hard_stalled` | 🔴 Rot | `Hard-Stall` | Manuelle Intervention erforderlich |

### Reason-Code → Operator-Empfehlung

| `stall_reason_code` | Empfohlene Aktion |
|---------------------|-------------------|
| `VALIDATE_EXAM_POOL_SOFT_STALL` | Abwarten — Repair wird automatisch gestartet |
| `VALIDATE_EXAM_POOL_TRUE_STALL` | Pool manuell prüfen: Sind genug Fragen vorhanden? Gibt es strukturelle Blocker? |
| `NO_PROGRESS_AFTER_REPAIR` | Repair-Logs prüfen: Was wurde repariert? Warum kein Delta? |
| `REPAIR_RUNNING_AWAITING_DELTA` | Nichts tun — Job läuft noch |
| `RECENT_HEAL_GRACE_ACTIVE` | Nichts tun — Grace läuft bis `grace_until` |

### Diagnostik-Daten für Leitstelle

Die `ValidateGuardDiagnosticsCard` zeigt:
- Guard-State (farbcodiertes Badge)
- Reason-Code (mit Operator-Empfehlung)
- `consecutive_no_progress` (Zähler)
- `last_progress_delta` (Delta-Objekt)
- `grace_until` (Countdown wenn aktiv)
- `meta_contract_heal_count` (Observability)
- Aktive Jobs (aus `package_generation_jobs`)

---

## Änderungshistorie

| Datum | Änderung |
|-------|----------|
| 2026-03-31 | Initiale SSOT-Dokumentation erstellt |
