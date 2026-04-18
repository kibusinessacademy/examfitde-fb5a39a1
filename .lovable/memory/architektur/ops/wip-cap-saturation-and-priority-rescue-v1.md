---
name: WIP-Cap Saturation & Priority Rescue v1
description: Wenn build-Lane durch homogenen Job-Type (z.B. generate_exam_pool) saturiert ist, bleiben heterogene downstream Steps (auto_publish, build_ai_tutor_index, quality_council) hängen. Heilung via Priority-Boost + Stale-Lock-Release.
type: feature
---

## Pattern: WIP-Cap Saturation by Homogeneous Job Type

### Symptom
- 10+ Pakete in `building` Status, "Festgefahren"-Badge.
- Pending Jobs ohne Errors, ohne Locks, `run_after` in Vergangenheit.
- Worker läuft (sichtbar an Completions in den letzten 15min).
- **Kennzeichen**: Alle `processing`-Slots der `build`-Lane (typisch 25) belegt mit demselben Job-Type (z.B. `package_generate_exam_pool`).

### Root Cause
- Wenn ein langlaufender Job-Type (`generate_exam_pool` mit ~5–15min Laufzeit) gleichzeitig für viele Pakete fan-outed, blockiert er den gesamten `build`-Lane WIP-Cap.
- Andere Steps (auto_publish, validate_*, build_ai_tutor_index) können die Lane nicht erreichen, obwohl sie schnell wären.
- `recovery`-Lane parallel überlastet (>90 pending, nur 1 processing).

### Diagnose-SQL
```sql
-- WIP-Cap Sättigung prüfen
SELECT lane, status, COUNT(*), 
  (SELECT job_type FROM job_queue j2 WHERE j2.lane=jq.lane AND j2.status=jq.status GROUP BY job_type ORDER BY COUNT(*) DESC LIMIT 1) AS dominant_type
FROM job_queue jq WHERE status='processing' GROUP BY lane, status;
```

### Heilung (manueller Bypass)
1. **Priority-Boost** für stuck Pakete: `priority = GREATEST(priority, 5)` + `run_after = now()`.
2. **Stale-Lock-Release** für `processing`-Jobs > 10min ohne Heartbeat-Update (typisch zombie/timeout).
3. **Drift-Fix**: Pakete mit `is_published=true` ohne `published_at` → `is_published=false` (Hollow-Publish-Drift).
4. Audit in `admin_actions` mit action_key `systemic_heal_<N>_stuck_packages`.

### Strukturelle Folgemaßnahmen (TODO)
- Per-Job-Type WIP-Sub-Caps in `claim_pending_jobs_v4` (z.B. max 15 `generate_exam_pool` parallel, restliche 10 Slots reserviert für andere Build-Types).
- `recovery`-Lane Worker-Concurrency erhöhen (aktuell offenbar nur 1 parallel).
- Cron-basierter Auto-Rescue: alle 5min für Pakete > 30min idle ohne aktiven Job → Priority-Boost auf 5.

### Bekannte Auslöser
- Mass-fanout nach `blueprint-fanout` für 25+ Pakete simultan.
- 25/25 build-Slots saturiert seit > 50min (Indikator: `mins_idle > 50` bei stuck Pakete).
