# Memory: architektur/ops/deadman-progress-guard-layer-v1
Updated: now

Der 'Deadman Progress Guard Layer' schließt vier kritische Observability-Lücken, die eine 48-stündige Pipeline-Blindheit ermöglichten (Incident 2026-03-14/16):

**G1 – Progress Guard** (`v_ops_package_progress_guard`): Klassifiziert Building-Pakete nach realem Fortschritt (HEALTHY, SLOWING, SHADOW_STALLED, IDLE_WITH_LEASE). SHADOW_STALLED = aktive Jobs + 0 Completions seit 30min. Korrigiert die bisherige Guardian-Annahme 'aktive Jobs = gesunde Verarbeitung'. **Gehärtet**: `pkg_updated_at` wird NICHT mehr als Progress-Signal verwendet — nur `last_completion_at` und `last_step_done_at` zählen als echte Fortschrittsereignisse. Spalte heißt `minutes_since_real_progress`.

**G2 – Batch Submit Health Guard** (`v_ops_batch_submit_health`): Überwacht die Submit-Erfolgsrate pro Provider/Model/JobType in einem 30min-Fenster. Stufen: HEALTHY (<30%), WARNING (30-50%), DEGRADED (50-80%), CRITICAL (>80%). Mindestvolumen: 3 Batches (View), P0-Schwelle: CRITICAL bei total>=10, DEGRADED bei total>=20. Verhindert unentdeckte Provider-Ausfälle.

**G3 – Health View → Notification Bridge**: Verbindet `v_ops_batch_recovery_health` RED-Status mit `admin_notifications`. Zustandsbasiert (nicht event-basiert): Neuer Alert nur bei Statuswechsel, 30min Dedup-Cooldown. Prüft alle 6 Health-Dimensionen: polling, import, output, routing, queue, overall.

**G4 – Shadow Zombie Detection** (`v_ops_shadow_zombies`): Cross-Table-Korrelation aus job_queue, llm_batches, llm_batch_requests, package_leases. **CASE-Reihenfolge gehärtet**: RETRYING kommt vor HEALTHY_ACTIVE (sonst unerreichbar). Klassifikationen: HEALTHY_ACTIVE, RETRYING (failed > completed), SHADOW_ZOMBIE (aktive Jobs + 0 Output + 0 Batch-Erfolge), POISONED_LOOP (>20 Retry-Attempts + 0 Output), HARD_STALLED (building + 0 Jobs).

**Guardian-Integration (gehärtet)**: Per-Package-Dedup statt globaler Dedup. Jeder Guard erzeugt deduplizierte P0/P1-Notifications mit `entity_id=package_id` und 60min (G1/G4) bzw. 30min (G2/G3) Cooldown. Guardian behandelt SHADOW_STALLED NICHT mehr als `guarded_active_work`. Alle Guards loggen in `auto_heal_log` mit detaillierten Metriken.
