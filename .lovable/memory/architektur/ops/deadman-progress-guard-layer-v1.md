# Memory: architektur/ops/deadman-progress-guard-layer-v1
Updated: now

Der 'Deadman Progress Guard Layer' schließt vier kritische Observability-Lücken, die eine 48-stündige Pipeline-Blindheit ermöglichten (Incident 2026-03-14/16):

**G1 – Progress Guard** (`v_ops_package_progress_guard`): Klassifiziert Building-Pakete nach realem Fortschritt (HEALTHY, SLOWING, SHADOW_STALLED, IDLE_WITH_LEASE). SHADOW_STALLED = aktive Jobs + 0 Completions seit 30min. Korrigiert die bisherige Guardian-Annahme 'aktive Jobs = gesunde Verarbeitung'. **Gehärtet**: `pkg_updated_at` wird NICHT mehr als Progress-Signal verwendet — nur `last_completion_at` und `last_step_done_at` zählen als echte Fortschrittsereignisse. Spalte heißt `minutes_since_real_progress`. **IDLE_WITH_LEASE wird ab 30min als Warning-Notification geloggt** (Lease-Leak-Frühwarnung).

**G2 – Batch Submit Health Guard** (`v_ops_batch_submit_health`): Überwacht die Submit-Erfolgsrate pro Provider/Model/JobType in einem 30min-Fenster. Stufen: HEALTHY (<30%), WARNING (30-50%), DEGRADED (50-80%), CRITICAL (>80%). Mindestvolumen: 3 Batches (View), P0-Schwelle: CRITICAL bei total>=10, DEGRADED bei total>=20, WARNING bei total>=10. **Dedupe ist fingerprint-spezifisch** über `entity_id = provider:model:job_type`. **Severity-Mapping**: CRITICAL→critical, DEGRADED→warning, WARNING→info.

**G3 – Health View → Notification Bridge**: Verbindet `v_ops_batch_recovery_health` RED-Status mit `admin_notifications`. Zustandsbasiert (nicht event-basiert): Neuer Alert nur bei Statuswechsel, 30min Dedup-Cooldown. Prüft alle 6 Health-Dimensionen: polling, import, output, routing, queue, overall. **Dedupe ist fingerprint-spezifisch** über `entity_id = sortierte RED-Felder`.

**G4 – Shadow Zombie Detection** (`v_ops_shadow_zombies`): Cross-Table-Korrelation aus job_queue, llm_batches, llm_batch_requests, package_leases. **CASE-Reihenfolge gehärtet**: RETRYING → HEALTHY_ACTIVE → **POISONED_LOOP → SHADOW_ZOMBIE** → HARD_STALLED. POISONED_LOOP steht jetzt VOR SHADOW_ZOMBIE, weil es die stärkere Diagnose ist.

**Guardian-Integration (gehärtet)**: Per-Package-Dedup statt globaler Dedup. Jeder Guard erzeugt deduplizierte P0/P1-Notifications mit `entity_id=package_id` (G1/G4) bzw. `entity_id=provider:model:job_type` (G2) bzw. `entity_id=red_fields` (G3). Cooldowns: 60min (G1/G4), 30min (G2/G3). Guardian behandelt SHADOW_STALLED NICHT mehr als `guarded_active_work`. Alle Guards loggen in `auto_heal_log` mit detaillierten Metriken.
