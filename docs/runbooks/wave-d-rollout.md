# Wave-D Rollout Runbook

**Scope:** Discovery → Intake → Qualification Catalog → Factory Scaling  
**Ziel:** Befüllung des Qualification Catalog und Aktivierung der Discovery-Pipeline, damit GTM-Scoring (Wave C Step 5) und autonome Kursproduktion für neue Berufe funktionieren.

---

## Rollout-Status

| Step | Komponente | Status |
|------|-----------|--------|
| 1 | Search Discovery | ⬜ |
| 2 | Fortbildungen Discovery | ⬜ |
| 3 | Document Fetch & Download | ⬜ |
| 4 | PDF Parse & Intake | ⬜ |
| 5 | Candidate Promotion | ⬜ |
| 6 | Catalog Entry Build | ⬜ |
| 7 | GTM Scoring (Wave C Step 5 unlock) | ⬜ |
| 8 | Factory Wave Sync | ⬜ |

---

## 1. Ziel von Wave D

Wave D aktiviert den Intake- und Discovery-Pfad:

```
Search/Fortbildung Discovery
  → Document Fetch
  → PDF Parse
  → Candidate Promotion
  → Qualification Catalog
  → GTM Scoring
  → Factory Wave Sync
```

### Neue aktive Tabellen

| Layer | Tabelle |
|-------|---------|
| Discovery | `curriculum_intake_candidates` |
| Jobs | `curriculum_intake_jobs` |
| Parsed | `curriculum_intake_parsed` |
| Catalog | `qualification_catalog` |
| GTM | `curriculum_gtm_scores` |

---

## 2. Preconditions (MUSS erfüllt sein)

**Wave C abgeschlossen:** Steps 1–4 grün ✅

**Queue-Check:**
```sql
SELECT
  count(*) FILTER (WHERE status='processing') AS processing,
  count(*) FILTER (WHERE status='pending') AS pending,
  count(*) FILTER (WHERE status='failed') AS failed
FROM job_queue;
```

| Metric | Limit |
|--------|-------|
| processing | < 20 |
| pending | < 500 |
| failed 1h | < 50 |

**Provider Health:**
```sql
SELECT count(*) FROM llm_provider_cooldowns WHERE until_at > now();
```
Erwartet: 0 oder ≤ 1

---

## 3. Aktivierungsreihenfolge

> **Sequenziell aktivieren. 5–10 Min Beobachtung zwischen Steps.**

### Step 1 — Search Discovery

**Function:** `qualification-search-discovery`

```bash
POST /functions/v1/qualification-search-discovery
{"limit": 20}
```

**Smoke Check:**
```sql
SELECT intake_status, count(*)
FROM curriculum_intake_candidates
GROUP BY intake_status;
```

Erwartet: `discovered` > 0

**🛑 Stop-Kriterium:** Keine neuen Candidates nach 2 Durchläufen

---

### Step 2 — Fortbildungen Discovery

**Function:** `qualification-discover-fortbildungen`

```bash
POST /functions/v1/qualification-discover-fortbildungen
{"limit": 50}
```

**Smoke Check:**
```sql
SELECT category, count(*)
FROM curriculum_intake_candidates
WHERE metadata->>'synthetic' = 'true'
GROUP BY category;
```

Erwartet: `fortbildung_ihk`, `fortbildung_hwk` Rows

---

### Step 3 — Document Fetch & Download

**Function:** `qualification-fetch-documents`

```bash
POST /functions/v1/qualification-fetch-documents
{"limit": 10}
```

**Smoke Check:**
```sql
SELECT job_type, status, count(*)
FROM curriculum_intake_jobs
GROUP BY job_type, status;
```

Erwartet: `download` Jobs mit Status `done` oder `processing`

---

### Step 4 — PDF Parse & Intake

**Function:** `curriculum-intake-worker` (parse mode)

```bash
POST /functions/v1/curriculum-intake-worker
{"job_type": "parse", "limit": 10}
```

**Smoke Check:**
```sql
SELECT count(*) AS parsed_rows
FROM curriculum_intake_parsed;
```

Erwartet: > 0

**Alternative: Full Intake Cron**
```bash
POST /functions/v1/curriculum-intake-cron
```
Führt Discover → Download → Parse → Promote sequenziell aus.

---

### Step 5 — Candidate Promotion

**Function:** `curriculum-promote-candidates`

```bash
POST /functions/v1/curriculum-promote-candidates
{"limit": 20}
```

**Smoke Check:**
```sql
SELECT intake_status, count(*)
FROM curriculum_intake_candidates
GROUP BY intake_status;
```

Erwartet: `promoted` > 0

---

### Step 6 — Catalog Entry Build

**Function:** `qualification-build-catalog-entry`

```bash
POST /functions/v1/qualification-build-catalog-entry
{"limit": 20}
```

**Smoke Check:**
```sql
SELECT status, count(*)
FROM qualification_catalog
GROUP BY status;
```

Erwartet: Rows in `qualification_catalog` > 0

**🛑 Stop-Kriterium:** `failed > 10`

---

### Step 7 — GTM Scoring (Wave C Step 5 unlock)

**Function:** `curriculum-gtm-score`

```bash
POST /functions/v1/curriculum-gtm-score
{"limit": 200}
```

**Smoke Check:**
```sql
SELECT count(*) AS gtm_rows
FROM curriculum_gtm_scores;

SELECT qualification_id, score
FROM curriculum_gtm_scores
ORDER BY score DESC
LIMIT 10;
```

Erwartet: Scores > 0

---

### Step 8 — Factory Wave Sync

**Function:** `qualification-wave-sync`

```bash
POST /functions/v1/qualification-wave-sync
```

**Smoke Check:**
```sql
SELECT status, count(*)
FROM qualification_catalog
GROUP BY status;
```

Erwartet: `active` oder `wave_ready` Einträge

---

## 4. Golden Path Test

```bash
npm run audit:master:full
```

Erwartet: `GO` oder `GO_WITH_WARNINGS`
GTM-Layer sollte jetzt `PASS` statt `WARN` liefern.

---

## 5. Observability während Rollout

| Signal | Bedeutung |
|--------|-----------|
| Provider cooldown | API Rate Limit |
| Parse failures | PDF-Extraktion fehlgeschlagen |
| Empty catalog entries | RPC-Fehler oder fehlende Daten |
| Queue pending spike | Worker Bottleneck |

---

## 6. Stop-Kriterien

Rollout **sofort stoppen** wenn:

| Kriterium | Schwellenwert |
|-----------|---------------|
| Provider cooldown | > 10 min dauerhaft |
| Job Queue pending | > 1000 |
| Failed jobs / Stunde | > 100 |
| Parse failures | > 20 konsekutiv |

---

## 7. Recovery

### Pause Intake
```sql
UPDATE curriculum_intake_jobs
SET status = 'pending'
WHERE status = 'processing'
AND updated_at < now() - interval '20 minutes';
```

### Queue Reset
```sql
UPDATE job_queue
SET status = 'pending'
WHERE status = 'processing'
AND updated_at < now() - interval '20 minutes';
```

### Provider Reset
```sql
DELETE FROM llm_provider_cooldowns;
```

---

## 8. Erfolgskriterien

| KPI | Ziel |
|-----|------|
| Intake Candidates discovered | > 20 |
| Documents parsed | > 10 |
| Candidates promoted | > 5 |
| Qualification Catalog entries | > 5 |
| GTM Scores | > 5 |
| Factory Wave Sync | ≥ 1 active |

---

## 9. Post-Rollout Audit

```bash
npm run audit:master:full
```

Erwartetes Ergebnis: Alle Layer `PASS`, GTM-Layer grün.

---

## 10. Nächste Welle

Nach stabiler Wave D → **Wave E: Factory Scaling + Autonomous Build**

- `factory-orchestrator`
- `admin-run-autonomous-factory`
- `production-guardian`
- Vollautonome Kursproduktion für neue Qualification-Catalog-Einträge
