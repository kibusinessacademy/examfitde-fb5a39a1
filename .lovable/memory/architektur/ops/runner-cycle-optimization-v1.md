---
name: Runner-Cycle Optimization v1
description: Scaler-Routing für pool_fill_/lesson_, abgesenkte Skalierungs-Thresholds, dynamischer Per-Package Fairness-Cap und v_runner_cycle_diagnostics SSOT-View für Throughput-Monitoring
type: feature
---

**4 Hebel zur Throughput-Steigerung im Job-Runner-Cycle:**

1. **`get_worker_scaling_recommendations` Routing-Fix** — `pool_fill_*` und `lesson_generate_*` zählen jetzt zur content-runner Workload (vorher: 0 → Auto-Scaler blind). `package_*` ohne `package_generate_*` bleibt pipeline-runner.

2. **Abgesenkte Skalierungs-Thresholds** in `worker_scaling_policies`:
   - content-runner: 40 → 8 (scale_up), 8 → 2 (scale_down)
   - pipeline-runner: 25 → 6 / 5 → 2
   - campaign/distribution: 20 → 5 / 3 → 1
   - optimization: 15 → 4 / 2 → 1
   Reaktivere Skalierung bei kleinerem Backlog.

3. **Dynamischer Fairness-Cap in `claim_pending_jobs_v4`** — vorher hart 3 Jobs/Paket/Tick. Jetzt: ≤2 unique Pakete → 8/Paket; ≤5 → 5; sonst 3. Verhindert Stagnation bei Backfill-Wellen für einzelne Pakete (z.B. 13 pool_fill_bloom_gaps für 1 Paket = jetzt 2 Ticks statt 5).

4. **`GENERATION_JOB_TYPES_LANE` erweitert** in `_shared/runner-lanes.ts` — content-runner claimt jetzt auch pool_fill_bloom_gaps/competency_gaps/lf_gaps und lesson_generate_competency_bundle/content. Vorher: diese Jobs hatten KEINEN Worker.

**Diagnose-View `v_runner_cycle_diagnostics`** zeigt pro Job-Type: pending, claimable_now, processing, 5-Min-Throughput (claimed/done/failed), Routing-Worker, oldest_pending_age_sec. SSOT für Runner-Idle-Forensik.

**Validierung nach Deploy**: Alle 3 pending pool_fill_bloom_gaps Jobs sofort geclaimt → processing=3. Erwartete Throughput-Steigerung: 3-5x für Pool-Fill-Backlogs.
