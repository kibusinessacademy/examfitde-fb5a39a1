# Phase 1 Deploy Runbook — Handbook Basis/Expand Trennung

> **Ziel:** Nach Deploy beweisen, dass Generate nur Basis schreibt, Expand separat läuft,
> und `failed_soft` niemals den Hauptfluss blockiert.

## Prüfblock A — Schema & Daten

### A1. Neue Spalten vorhanden?
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'handbook_sections'
  AND column_name IN ('basis_content','expanded_content','content_markdown','content_tier',
    'basis_generated_at','expanded_at','expand_status','expand_attempts',
    'expand_last_error','expand_provider','expand_model','quality_score','depth_markers')
ORDER BY column_name;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| 13 Zeilen | Spalten fehlen | Migration re-run |

### A2. Backfill korrekt?
```sql
SELECT COUNT(*) AS total,
  COUNT(*) FILTER (WHERE basis_content IS NULL AND content_markdown IS NOT NULL) AS suspicious
FROM handbook_sections;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| `suspicious = 0` | > 0 | `UPDATE handbook_sections SET basis_content = content_markdown WHERE basis_content IS NULL AND content_markdown IS NOT NULL;` |

### A3. Expand-Initialstatus
```sql
SELECT expand_status, COUNT(*) AS cnt FROM handbook_sections GROUP BY expand_status ORDER BY cnt DESC;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| `pending` + `not_ready` | Unbekannte Werte | Prüfe Migration-Backfill-Logik |

---

## Prüfblock B — Pipeline-Registrierung

### B1. Step-Keys auf Paketebene
```sql
SELECT step_key, COUNT(*) FROM package_steps
WHERE step_key IN ('generate_handbook','validate_handbook','enqueue_handbook_expand','expand_handbook','validate_handbook_depth')
GROUP BY step_key ORDER BY step_key;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| Alle 5 Keys vorhanden | Neue Keys fehlen | Pipeline noch nicht gelaufen — nach erstem Run erneut prüfen |

### B2. Neue Job-Typen aktiv?
```sql
SELECT job_type, COUNT(*) FROM job_queue
WHERE created_at > now() - interval '24 hours'
  AND job_type IN ('package_enqueue_handbook_expand','handbook_expand_section','package_validate_handbook_depth')
GROUP BY job_type;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| Jobs erscheinen nach Run | Keine Jobs | Prüfe `job-map.ts` Registrierung + Pipeline-Runner-Logs |

---

## Prüfblock C — Generate = Basis-Only

### C1. Keine vorzeitige Expansion
```sql
SELECT COUNT(*) AS suspicious
FROM handbook_sections
WHERE basis_generated_at IS NOT NULL AND expanded_at IS NULL AND expanded_content IS NOT NULL;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| `0` | > 0 | Generate schreibt noch `expanded_content` — prüfe `package-generate-handbook` |

### C2. Content-Tier korrekt nach Generate
```sql
SELECT content_tier, COUNT(*) FROM handbook_sections
WHERE basis_generated_at IS NOT NULL GROUP BY content_tier;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| Nur `basis` | `expanded` ohne Expand-Run | Generate-Step setzt falschen Tier |

---

## Prüfblock D — Validate prüft nur Basis

### D1. validate_handbook unabhängig von Expand
```sql
SELECT ps.step_key, ps.status,
  COUNT(*) FILTER (WHERE hs.expand_status IN ('pending','failed_soft','not_ready')) AS non_done_expand
FROM package_steps ps
JOIN handbook_chapters hc ON hc.curriculum_id = (ps.meta->>'curriculum_id')::uuid
JOIN handbook_sections hs ON hs.chapter_id = hc.id
WHERE ps.step_key = 'validate_handbook' AND ps.status = 'done'
GROUP BY ps.step_key, ps.status;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| `done` trotz `non_done_expand > 0` | validate_handbook blockiert | Prüfe `package-validate-handbook` — darf nur `basis_content` / `content_markdown` lesen |

---

## Prüfblock E — Expand-Queue & Idempotenz

### E1. Keine doppelten aktiven Jobs
```sql
SELECT payload->>'section_id' AS section_id, COUNT(*) AS active_jobs
FROM job_queue
WHERE job_type = 'handbook_expand_section' AND status IN ('pending','processing')
GROUP BY payload->>'section_id' HAVING COUNT(*) > 1;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| Leere Ergebnismenge | Duplikate | Prüfe Idempotenz-Guard in `package-enqueue-handbook-expand` |

---

## Prüfblock F — Expand weich & non-blocking

### F1. Basis nie zerstört
```sql
SELECT COUNT(*) AS broken
FROM handbook_sections
WHERE basis_content IS NOT NULL AND char_length(basis_content) >= 800
  AND char_length(COALESCE(content_markdown, '')) < 400;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| `0` | > 0 | Expand überschreibt `content_markdown` mit kürzerem Text — Bug in `expand-handbook-section` |

### F2. Kein harter Job-Fail bei Expand
```sql
SELECT status, COUNT(*) FROM job_queue
WHERE job_type = 'handbook_expand_section' AND created_at > now() - interval '24 hours'
GROUP BY status;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| Kein `failed` | `failed` vorhanden | `expand-handbook-section` gibt HTTP 500 zurück — Patch: muss immer 200 returnen |

---

## Prüfblock G — Step-Completion

### G1. expand_handbook Abschlusslogik
```sql
WITH sec AS (
  SELECT package_id,
    COUNT(*) FILTER (WHERE expand_status IN ('pending','expanding')) AS open_expand,
    COUNT(*) FILTER (WHERE expand_status = 'done') AS done_expand,
    COUNT(*) FILTER (WHERE expand_status IN ('failed_soft','not_ready')) AS soft_terminal
  FROM handbook_sections GROUP BY package_id
)
SELECT ps.package_id, ps.status, sec.open_expand, sec.done_expand, sec.soft_terminal
FROM package_steps ps JOIN sec ON sec.package_id = ps.package_id
WHERE ps.step_key = 'expand_handbook';
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| `done` wenn `open_expand = 0` | `done` bei `open_expand > 0` | Completion-Guard zu lax |
| `done` trotz `soft_terminal > 0` | `failed` bei `soft_terminal > 0` | `softFailOnSubjobError` nicht aktiv |

---

## Prüfblock H — Depth Soft-Gate

### H1. validate_handbook_depth blockiert nicht
```sql
SELECT step_key, status, meta->>'quality_tier' AS tier, meta->>'soft_fail' AS soft_fail
FROM package_steps WHERE step_key = 'validate_handbook_depth';
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| Status nie `failed` | `failed` | Soft-Gate-Logik prüfen in `package-validate-handbook-depth` |

---

## Prüfblock I — LLM-Routing

### I1. Generate vs Expand getrennt in Kosten
```sql
SELECT job_type, provider, model, COUNT(*) AS calls
FROM llm_cost_events
WHERE created_at > now() - interval '24 hours'
  AND job_type IN ('generate_handbook','package_generate_handbook','handbook_expand_section')
GROUP BY job_type, provider, model ORDER BY job_type, calls DESC;
```
| ✅ Soll | ❌ Fehlerbild | 🔧 Maßnahme |
|---|---|---|
| Flash dominiert Generate, Heavy dominiert Expand | Heavy in Generate | `_handbookChain` in `package-generate-handbook` nutzt noch Heavy-Modelle |

---

## Entscheidungsmatrix

| Alle A-F grün | G grün | H grün | I grün | → Urteil |
|---|---|---|---|---|
| ✅ | ✅ | ✅ | ✅ | **Phase 1 sauber deployed** |
| ✅ | ❌ | - | - | Completion-Logik defekt |
| ❌ (C) | - | - | - | Generate/Expand noch vermischt |
| ✅ | ✅ | ❌ | - | Depth-Gate zu hart |
| ✅ | ✅ | ✅ | ❌ | Routing-Drift — Model-Chain prüfen |

---

## Letzter Live-Check (Stand: 2026-03-10)

| Check | Ergebnis |
|---|---|
| A1 Spalten | ✅ 13/13 vorhanden |
| A2 Backfill | ✅ 0 suspicious, 59/59 backfilled |
| A3 Expand-Status | ✅ 51 pending, 8 not_ready |
| B1 Step-Keys | ⏳ Neue Keys erst nach Pipeline-Run |
| C1 Keine vorzeitige Expansion | ✅ 0 suspicious |
| E1 Keine Duplikate | ✅ Leere Menge |
| F1 Basis intakt | ✅ 0 broken |
| F2 Kein harter Expand-Fail | ✅ Keine Jobs (noch kein Run) |
