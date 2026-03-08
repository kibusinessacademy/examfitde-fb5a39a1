# Wave E Runbook — Factory Scaling & Autonomous Build

> Wave D hat Discovery → Catalog → GTM → Wave-Candidates erfolgreich aktiviert.
> Wave E aktiviert jetzt die autonome Kursproduktion aus diesen Kandidaten.

**Ziel:** `qualification_wave_candidates` → `course_packages` → pipeline build

---

## 1. Pre-Flight Checks

### Wave Candidates vorhanden
```sql
SELECT count(*) FROM qualification_wave_candidates WHERE status = 'ready';
-- Erwartet: > 0
```

### Queue-Gesundheit
```sql
SELECT
  count(*) FILTER (WHERE status='pending') AS pending,
  count(*) FILTER (WHERE status='processing') AS processing,
  count(*) FILTER (WHERE status='failed') AS failed
FROM job_queue;
```

| Signal | Schwelle |
|--------|----------|
| pending | > 500 → STOP |
| failed_1h | > 50 → STOP |
| processing | dauerhaft 0 → STOP |

### Provider Routing Health
```sql
SELECT * FROM v_provider_routing_health;
```
Stop wenn: alle Provider gleichzeitig im Cooldown.

---

## 2. Aktivierungsstrategie

**Nicht alle Kandidaten gleichzeitig starten.**

| Phase | Kandidaten | Wartezeit |
|-------|-----------|-----------|
| Phase 1 — Small Batch | 2 | 10–15 min beobachten |
| Phase 2 — Medium Batch | 5 | 10–15 min beobachten |
| Phase 3 — Full Wave | 10 | Monitoring |

---

## 3. Step 1 — Factory Orchestrator

```
POST /functions/v1/factory-orchestrator
{"limit": 2}
```

### Smoke Check
```sql
SELECT status, count(*) FROM course_packages GROUP BY status;
-- Erwartet: queued > 0, building > 0
```

---

## 4. Step 2 — Autonomous Factory Runner

```
POST /functions/v1/admin-run-autonomous-factory
{"limit": 2}
```

### Smoke Check
```sql
SELECT title, status, build_progress
FROM course_packages ORDER BY created_at DESC LIMIT 10;
-- Erwartet: status = building, build_progress > 0
```

---

## 5. Step 3 — Pipeline Activation

Pipeline Steps:
`scaffold_learning_course` → `generate_glossary` → `generate_learning_content` →
`generate_exam_pool` → `validate_exam_pool` → `generate_handbook` →
`quality_gate` → `auto_publish`

```sql
SELECT step_key, status, count(*)
FROM package_steps GROUP BY step_key, status ORDER BY step_key;
```

---

## 6. Observability

| Metric | Erwartung |
|--------|-----------|
| lessons_last_hour | steigt |
| cooldown_loss | niedrig |
| fail_rate_pct | <20% |
| ETA | sinkt |

---

## 7. Stop-Kriterien

| Signal | Schwelle |
|--------|----------|
| Provider cooldown | >5 min dauerhaft |
| pending jobs | >1000 |
| failed jobs / h | >100 |
| parse failures | >20 |

---

## 8. Recovery

### Pipeline Pause
```sql
UPDATE course_packages SET status='paused' WHERE status='building';
```

### Job Reset
```sql
UPDATE job_queue SET status='pending'
WHERE status='processing' AND updated_at < now() - interval '20 minutes';
```

### Provider Reset
```sql
DELETE FROM llm_provider_cooldowns;
```

---

## 9. Success Criteria

| KPI | Ziel |
|-----|------|
| new course_packages | ≥2 |
| pipeline building | ≥1 |
| lessons generated | >10 |
| fail_rate | <20% |
| queue stable | ja |

---

## 10. Skalierung

- Phase 1 stabil → `limit: 5`
- Phase 2 stabil → `limit: 10`

---

## 11. Erwarteter Effekt

```
qualification_wave_candidates
        ↓
course_packages
        ↓
pipeline runner
        ↓
lessons / exams / handbook
        ↓
published courses
```

→ **Autonome Kursproduktion**

---

## 12. Nächster Evolutionsschritt (Wave F)

- Market-Signal-Integration
- SEO-Traffic-Feedback
- Dynamic GTM Scores
- Auto-Priorisierung neuer Berufe
