# Memory: architektur/ops/deadman-progress-guard-layer-v1
Updated: now

Der 'Deadman Progress Guard Layer' schließt vier kritische Observability-Lücken, die eine 48-stündige Pipeline-Blindheit ermöglichten (Incident 2026-03-14/16):

**G1 – Progress Guard** (`v_ops_package_progress_guard`): Klassifiziert Building-Pakete nach realem Fortschritt (HEALTHY, SLOWING, SHADOW_STALLED, IDLE_WITH_LEASE). SHADOW_STALLED = aktive Jobs + 0 Completions seit 30min. Korrigiert die bisherige Guardian-Annahme 'aktive Jobs = gesunde Verarbeitung'.

**G2 – Batch Submit Health Guard** (`v_ops_batch_submit_health`): Überwacht die Submit-Erfolgsrate pro Provider/Model/JobType in einem 30min-Fenster. Stufen: HEALTHY (<30%), WARNING (30-50%), DEGRADED (50-80%), CRITICAL (>80%). Mindestvolumen: 3 Batches. Verhindert unentdeckte Provider-Ausfälle.

**G3 – Health View → Notification Bridge**: Verbindet `v_ops_batch_recovery_health` RED-Status mit `admin_notifications`. Zustandsbasiert (nicht event-basiert): Neuer Alert nur bei Statuswechsel, 30min Dedup-Cooldown. Prüft alle 6 Health-Dimensionen: polling, import, output, routing, queue, overall.

**G4 – Shadow Zombie Detection** (`v_ops_shadow_zombies`): Cross-Table-Korrelation aus job_queue, llm_batches, llm_batch_requests, package_leases. Klassifikationen: HEALTHY_ACTIVE, SHADOW_ZOMBIE (aktive Jobs + 0 Output + 0 Batch-Erfolge), POISONED_LOOP (>20 Retry-Attempts + 0 Output), HARD_STALLED (building + 0 Jobs).

Alle Guards sind dedupliziert (30min Cooldown), loggen in `auto_heal_log` und feuern P0-Notifications in `admin_notifications` mit Severity 'critical'. Ausführung im `production-guardian` Cron-Zyklus (alle 20min).
