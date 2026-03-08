# Wave-C Rollout Runbook

**Scope:** Campaign → Distribution → Optimization  
**Ziel:** Aktivierung der operativen Growth-Layer nach erfolgreichem Plattform-GO.

---

## 1. Ziel von Wave C

Wave C aktiviert den Marketing- und Distributionspfad:

```
Factory → Campaign Generation → Distribution → Optimization → Revenue Attribution
```

### Neue aktive Tabellen

| Layer        | Tabelle                    |
|-------------|----------------------------|
| Campaign    | `campaign_launch_plans`    |
| Assets      | `campaign_assets`          |
| Distribution| `distribution_publications`|
| Optimization| `asset_optimization_scores`|
| GTM         | `curriculum_gtm_scores`    |

---

## 2. Preconditions (MUSS erfüllt sein)

```bash
npm run audit:master
```

**Erwartetes Ergebnis:**
- `VERDICT: GO` oder `GO_WITH_WARNINGS` (only early-phase warnings)

**Queue-Check:**
```sql
SELECT
  count(*) FILTER (WHERE status='processing') as processing,
  count(*) FILTER (WHERE status='pending') as pending,
  count(*) FILTER (WHERE status='failed') as failed
FROM job_queue;
```

| Metric     | Limit  |
|-----------|--------|
| processing | < 20   |
| pending    | < 500  |
| failed 1h  | < 50   |

---

## 3. Aktivierungsreihenfolge

> **Nicht alles gleichzeitig aktivieren.**

### Step 1 — Campaign Engine

**Cron/Function:** `campaign-automation-cron`

```bash
POST /functions/v1/campaign-automation-cron
```

**Smoke Check:**
```sql
SELECT status, count(*)
FROM campaign_launch_plans
GROUP BY status;
```

Erwartet: `queued`, `ready`, `in_progress`

**🛑 Stop-Kriterium:** `failed > 50`

---

### Step 2 — Campaign Assets erzeugen

**Cron:** `campaign-asset-builder-cron`

**Check:**
```sql
SELECT channel, count(*)
FROM campaign_assets
GROUP BY channel;
```

Typische Channels: `seo`, `blog`, `youtube`, `tiktok`, `linkedin`

---

### Step 3 — Distribution aktivieren

**Cron:** `distribution-cron`

**Check:**
```sql
SELECT publication_status, count(*)
FROM distribution_publications
GROUP BY publication_status;
```

Erwartet: `queued`, `published`, `failed`

**🛑 Stop-Kriterium:** `failed > 20`

---

### Step 4 — Optimization Engine

**Cron:** `optimization-cron`

**Check:**
```sql
SELECT avg(score), count(*)
FROM asset_optimization_scores;
```

Sollte > 0 sein.

---

### Step 5 — GTM Scores

**Cron:** `gtm-scorer-cron`

**Check:**
```sql
SELECT qualification_id, score
FROM curriculum_gtm_scores
ORDER BY score DESC
LIMIT 10;
```

---

## 4. Golden Path Test

```bash
# Probe: e2e_golden_path
```

Erwartet: `PASS` oder `WARN` (nur bei wenig Daten)

---

## 5. Observability während Rollout

**Dashboard:** Ops & Auto-Heal

| Signal              | Bedeutung           |
|--------------------|---------------------|
| Provider cooldown  | API Rate Limit      |
| pending spike      | Worker Bottleneck   |
| failed jobs        | Provider Fehler     |
| dead jobs          | Pipeline Fehler     |

---

## 6. Stop-Kriterien

Rollout **sofort stoppen** wenn:

| Kriterium                | Schwellenwert        |
|-------------------------|----------------------|
| Provider cooldown       | > 10 min dauerhaft   |
| Job Queue pending       | > 1000               |
| Failed jobs / Stunde    | > 100                |
| Distribution failures   | > 50                 |

---

## 7. Recovery

### Pause Campaign
```sql
UPDATE campaign_launch_plans
SET status='paused'
WHERE status='queued';
```

### Queue Reset
```sql
UPDATE job_queue
SET status='pending'
WHERE status='processing'
AND updated_at < now() - interval '20 minutes';
```

### Provider Reset
```sql
DELETE FROM llm_provider_cooldowns;
```

---

## 8. Post-Rollout Audit

```bash
npm run audit:master:full
```

Erwartetes Ergebnis: Alle Layer `PASS`, keine Early-Phase Warns mehr.

---

## 9. Erfolgskriterien

| KPI                       | Ziel  |
|--------------------------|-------|
| Campaign Plans           | > 10  |
| Campaign Assets          | > 50  |
| Distribution Publications| > 20  |
| Optimization Scores      | > 50  |
| GTM Scores               | > 20  |

---

## 10. Nächste Welle

Nach stabiler Wave C → **Wave D: Discovery + Factory Scaling**

- `search-discovery-cron`
- `factory-wave-cron`
- `curriculum-intake-engine`
