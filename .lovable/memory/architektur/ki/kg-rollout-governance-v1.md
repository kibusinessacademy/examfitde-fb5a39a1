# Memory: architektur/ki/kg-rollout-governance-v1
Updated: now

Der Knowledge Graph (KG) Prompt-Injection-Rollout für `package_generate_exam_pool` folgt einem DB-gesteuerten Feature-Flag-Pattern:

1. **Config-Flags** (`ops_pipeline_config`):
   - `kg_exam_pool_enabled` (bool): Globaler Kill-Switch — sofort deaktivierbar ohne Redeploy.
   - `kg_exam_pool_rollout_pct` (0–100): Deterministischer Rollout-Prozentsatz.

2. **Deterministischer Gate** (`_shared/kg-rollout.ts`):
   - `shouldInjectKG(sb, blueprintId)` nutzt einen stabilen Hash auf `blueprint_id`, sodass dieselben Blueprints konsistent im Rollout sind.
   - Config wird 60s gecacht, um bei Fan-out-Jobs (N Blueprints) nur 1 DB-Query pro Minute zu fahren.
   - Kein `Math.random()` — reproduzierbar und debugbar.

3. **Integration**: Beide Pfade (Sync in `generateRawCandidates` und Batch in `submitExamPoolBatch`) prüfen den Gate vor dem KG-Query. Blueprints außerhalb des Rollouts bekommen keinen KG-Kontext, die Generierung läuft normal weiter.

4. **Telemetrie**: `InvocationQualityMetrics` enthält `kg_rollout_enabled`, `kg_rollout_pct`, `kg_blueprints_gated` zusätzlich zu `kg_context_hits/misses/errors_injected`. Damit lässt sich im Dashboard der KG-Effekt vs. Baseline direkt vergleichen.

5. **Rollout-Plan**: Phase 1: 10% (24h), Phase 2: 25% (48h), Phase 3: 50% (3d), Phase 4: 100%.

6. **Rollback**: `UPDATE ops_pipeline_config SET value = '"false"'::jsonb WHERE key = 'kg_exam_pool_enabled'` — sofort wirksam.
