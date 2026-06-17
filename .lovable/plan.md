
## Befund

### GitHub Actions
- **119 Workflows** in `.github/workflows/`
- **~110 davon `workflow_dispatch`-only** (kein PR/Push/Schedule-Trigger) — reine Shelf-Guards ohne CI-Surface
- **~9 mit echten Triggern:**
  - `schedule:` — `customer-reality-gate`, `learner-reality-daily`, `pre-customer-reality-daily`, `reality-gate-parity`, `post-deploy-go-status`, `post-deploy-vibeos-separation`, `seo-stability-7d-report`
  - `push/pull_request:` — `auth-org-context-e2e`, `b2b-route-render`, `merge-publish-gate`, `release-candidate-checklist`, `ux-gap-pr-gate`, `ux-gap-scan-regression`, `vercel-prerender-gate`

### Cron Jobs (cron.job)
- **215 active jobs, 0 inactive** — keine Hygiene
- Schedule-Verteilung: 41×`*/5min`, 33×`*/10min`, 24×`*/15min`, 16×`*/30min`, 6×`* * * * *`
- **Top-failing (letzte 24h, 100% fail rate):**
  - `materialize-ready-step-jobs` — 720/720 fail → `statement timeout` in `fn_should_log_blocked_skip`
  - `auto-ops-cycle` — 57/288 fail → kaskadiert aus obigem
  - `heal-orphan-queued-steps` — 288/288 fail
  - `dag-blocked-alert-and-heal-10min` — 144/144 → `ERROR: forbidden` (Admin-RPC ohne Rolle)
  - `queued-tail-reconciler-v2-10min` — 144/144
  - `ops-cancel-skip-rise-alert-10min` — 144/144
  - `b2b-renewal-intent-producer-hourly` — 24/24 → Schema-Drift: `auto_heal_log.payload` Spalte fehlt
  - 10+ weitere hourly heals mit 100% fail rate
- **Echte Duplikate (Command-Hash):**
  - `snapshot-release-classification-daily` ↔ `snapshot-release-classification-6h`
  - `daily-ops-report-7am-cet` ↔ `daily-ops-report-17h-cet` (gleicher Command, anderer Zeitpunkt — vermutlich gewollt)
- **Mehrfach-getriggerte Edge-Functions:**
  - `cron-trigger` ×3, `unified-audit-runner` ×3, `content-runner` ×2, `control-plane-cron` ×2

## Plan

### Phase 1 — Cron Repair (höchste Priorität, sofort umsetzbar)
Architecture Freeze konform — wir reparieren, löschen nicht.

1. **`materialize-ready-step-jobs` Statement-Timeout fixen**
   - `fn_should_log_blocked_skip` & `fn_materialize_ready_step_jobs` profilen
   - Wahrscheinliche Ursache: full table scan auf `job_queue`/`package_steps` ohne passenden Index
   - Migration: Index ergänzen + `LIMIT` im Heißpfad
   - Wenn keine schnelle Lösung: Job auf `*/5min` drosseln statt jede Minute

2. **`dag-blocked-alert-and-heal-10min` "forbidden" Fix**
   - Cron läuft als `postgres`, Funktion erwartet `service_role` oder `has_role(...,'admin')`
   - Fix: `SECURITY DEFINER` setzen oder Cron auf `net.http_post` zu Edge-Function umstellen (mit service_role header)

3. **`b2b-renewal-intent-producer-hourly` Schema-Drift fixen**
   - `fn_emit_b2b_renewal_intents` schreibt nach `auto_heal_log.payload`, Spalte heißt jetzt `metadata`
   - Migration: Funktion patchen (`payload` → `metadata`)

4. **Cron-Job-Hygiene**
   - Job-Run-Health-View `v_admin_cron_health` (24h fail rate, last error)
   - Auto-Disable-Policy: Job mit 100% fail rate über 24h → `cron.alter_job(active:=false)` mit Audit
   - Doppelte `snapshot-release-classification-*` → die 6h-Variante deaktivieren

### Phase 2 — GitHub Workflow Konsolidierung
Vorschlag (Approval nötig pro Schritt — keine Bulk-Deletes):

- **Cluster A: Smoke/Guards in Composite Workflow bündeln**
  Aus ~80 `workflow_dispatch`-only Guards einen einzigen `nightly-guards.yml` mit `matrix:` machen, der die alten Skripte aufruft. Die Einzel-YMLs bleiben als manuell aufrufbar (kein Löschen, nur ein neuer Sammler).

- **Cluster B: Echte Schedule-Workflows zusammenführen**
  `customer-reality-gate` / `learner-reality-daily` / `pre-customer-reality-daily` / `reality-gate-parity` laufen alle morgens hintereinander → 1 Workflow mit sequenziellen Jobs.

- **Cluster C: `post-deploy-*` zusammenführen**
  `post-deploy-go-status` + `post-deploy-vibeos-separation` → ein Workflow mit 2 Jobs.

### Phase 3 — Cron Konsolidierungs-View
- Read-Only Admin-Karte `/admin/ops/cron-health`: Liste aller Cron-Jobs mit
  Schedule, runs_24h, fails_24h, last_error, "Disable"-Button (admin-gated, RPC-only).
- Kein Auto-Disable in Phase 2/3 — nur Sichtbarkeit, manuelle Aktion.

### Leitplanken
- Architecture Freeze respektieren: Cron-Jobs nicht löschen, nur deaktivieren oder reparieren
- Jede Cron-Mutation in `auto_heal_log` auditieren
- Workflow-YMLs bleiben erhalten (Bestandsschutz) — nur zusätzliche Sammler-Workflows
- Schema-Drift-Fixes laufen über reguläre Migration, einzeln und reviewbar

## Empfohlene Reihenfolge

1. **Sofort (kleine Migrationen, hoher Impact):** Phase 1 Schritte 1–3 (drei kaputte Cron-Funktionen reparieren — stoppt ~1.500 Failures/Tag)
2. **Danach:** Phase 1 Schritt 4 (Cron-Health-View + Audit, ohne Auto-Disable)
3. **Optional:** Phase 2 (Workflow-Sammler) — nur wenn du Workflow-Sprawl im UI loswerden willst
4. **Optional:** Phase 3 (Admin-Karte Cron-Health)

## Frage
Welche Phasen soll ich umsetzen? Empfehlung: **Phase 1.1–1.3 sofort** (die drei kaputten Funktionen), Rest separat freigeben.
