
## Ziel

`/admin/heal?queue_tab=live` ist heute eine 698-Zeilen-Seite mit ~80 Cards und vergräbt die wichtigsten Heal-Aktionen. Außerdem schlagen reproduzierbar Edge-Functions fehl:
- `admin-ops-actions` — 500 ("Cannot coerce to single JSON object" + 1× Statement-Timeout)
- diverse `*-worker`, `send-learner-push`, `heal-alert-notify` — 401 (kein Bearer im internen Aufruf)
- `package-generate-exam-pool`, `lesson-generate-content` — 503 (AI-Gateway-Backpressure)

Aus den Antworten:
- Scope: **alle drei Fehler-Kategorien fixen**
- Top-Section: **Heal-Function Launcher (Grid mit Buttons)**
- KPI-Cards: **Hard-Trim — nur 10 wichtigste behalten, Rest auf `/admin/heal/diagnostics` auslagern**

## Lieferumfang

### A) Heal Function Launcher (neue Top-Section)

Neue Komponente `src/components/admin/heal/HealFunctionLauncher.tsx` — kompaktes 3-Spalten-Grid (mobil 1, tablet 2) direkt unter dem Page-Header. Jede Tile zeigt:

- Icon + Label + 1-Zeilen-Hint
- Last-Run-Timestamp + Last-Status-Badge (`ok` / `error` / `nie ausgeführt`)
- Run-Button → öffnet `AlertDialog` (Confirm) → ruft die Funktion auf
- Live-Status-Spinner während Pending

Heal-Funktionen, die in der Tile-Grid erscheinen (gruppiert via Section-Header):

| Gruppe | Action | Backend |
|---|---|---|
| Lane-Reaper | Reap Control · Reap All · Reset Stale · Cancel Zombies | RPC `admin_reap_stale_processing_now`, ops-action `reset_stale_processing`, `cancel_zombie_noop_jobs` |
| Bulk | Heal Finalization Stall · Heal Non-Building · Bulk Promote Queued | `heal_finalization_stall`, `heal_non_building`, RPC `admin_bulk_promote_queued_to_building` |
| Pakete | Force Publish Release-OK · Reconcile Pipeline Tail · Hard-Rebuild | `force_publish_release_ok`, `reconcile_pipeline_tail`, `hard_depublish_and_rebuild` |
| Sellable / Stripe | Sellable Recovery Batch · Stripe Sync Reaper · Demote Empty | edge `sellable-recovery-batch`, `stripe-sync-reaper`, RPC `admin_demote_empty_course` |
| Ghosts / Cleanup | Ghost Completions · Purge Completed · Zombie Sweep · Full Queue Reset | `heal_ghost_completions`, `purge_completed_jobs`, `zombie_sweep`, `full_queue_reset` |

Last-Run/Status werden aus `auto_heal_log` per Single-Query (`limit 1 order by created_at desc per action_type`) gelesen und alle 30s automatisch refresht.

### B) Cockpit-Layout schlanker

Neue Page-Struktur:

```
AdminPageHeader (Heal Cockpit)
AlertsBanner
HealKpiHeroCard
NextActionCard
HealFunctionLauncher                 ← NEU (Top-Section)

Accordion (default open: pulse, recover)
  1. Pulse         → LaneHealthCard, ThroughputCard, WorkerHeartbeatSSOTCard,
                      LaneReasonBreakdownCard, BlockerCountsCard
  2. Quick Recover → RecoverActionsCard, QueueDrainCard
  3. Pakete heilen → 10 wichtigste:
                      PublishTailBlockersCard, StuckPatternsCard,
                      HealStatusCard, BlockedPackagesCard,
                      RecurringPatternsCard, CourseHealPlansCard,
                      PaidButNotDeliveredCard, CustomerSafeReadinessCard,
                      OperationalStateCard, TargetedHealCard
  4. Erweitert     → Triage/Recheck/Drilldown/Selector/Reaper/Strategy/Queue-Tabs
                      (unverändert)
```

Die anderen ~60 Cards (TrackM4-9, alle Notification*, Growth/Attribution/Drift/Snapshot, Seo*, Adaptive*, Cognitive/Temporal/Predictive, alle Cancel/Pending/Worker-Forensics, etc.) wandern in:

`src/pages/admin/v2/HealDiagnosticsPage.tsx` — neue Route `/admin/heal/diagnostics`. Gleiche Card-Sammlung, gruppiert in 6 Tabs (Worker · Notifications · Tracks · Growth · SEO · Intelligence). Link aus dem Cockpit-Header rechts oben („Alle Diagnose-Cards").

Bestehende Redirects bleiben erhalten.

### C) Edge-Function-Fixes

**`admin-ops-actions`**
- `workspaceSnapshot` (Zeile 1536): `.single()` → `.maybeSingle()` mit 404-Fallback (Package könnte gelöscht sein → das ist die "Cannot coerce" Ursache).
- Audit-Wrapper: jede Action gibt zukünftig **immer** ein Top-Level-Objekt `{ ok, action, duration_ms, result }` zurück, auch im Fehlerfall (keine `throw` aus Action-Body raus zur PostgREST-Schicht durchreichen → vermeidet künftige Coerce-Probleme).
- Timeout-Schutz: `Promise.race` mit 25s-Cap für jede Action; bei Timeout `ok: false, error: 'action_timeout'` statt 504/500.

**Worker-401**
- `supabase/functions/_shared/internal-auth.ts` (neu): zentraler Helper `withInternalAuth(req)` der entweder gültigen User-JWT oder `x-internal-secret == INTERNAL_CRON_SECRET` akzeptiert.
- Patch in: `send-learner-push`, `learner-readiness-worker`, `intervention-intelligence-worker`, `post-purchase-delivery-worker`, `learner-activation-worker`, `heal-alert-notify`, `backfill-conflict-type`, `admin-production-supervisor-cron`. Bestehender Cron-Aufruf liefert dieses Secret bereits über `service_role`, aber die Funktionen prüfen aktuell strikt User-JWT.

**AI-Gateway-503**
- In `package-generate-exam-pool` und `lesson-generate-content`: Bei 503/429 → `auto_heal_log` Eintrag `action_type='ai_gateway_backpressure'` + Job mit `run_after = now() + (2^attempts * 30s)` requeuen statt failed setzen.
- Kein UI-Eingriff hier — nur Resilienz.

### D) Smoke-Tests

`scripts/heal-launcher-smoke.mjs` — pingt alle Launcher-Actions im Dry-Run-Modus (`x-dry-run: 1`) und schreibt ein Markdown-Report nach `/tmp/heal-launcher-report.md`. Wird als `npm run heal:smoke` registriert.

## Technische Details

- Keine SSOT-Brüche: Bulk-Publish bleibt SSOT-clamp (24,90 € · 12 Monate · Cap 18).
- Audit: jede Launcher-Action schreibt `auto_heal_log` mit `triggered_by='admin_heal_cockpit'`.
- Bestehende Cards werden **nicht gelöscht**, nur verschoben (Diagnostics-Page). Route-Registry wird ergänzt um `/admin/heal/diagnostics`.
- Memory-Leaf: `.lovable/memory/features/heal-cockpit-launcher-v1.md`.

## Out of Scope

- Keine neuen Heal-Strategien, keine neuen RPCs.
- Kein Refactor von Pulse/Queue-Tabs.
- Kein Re-Design der KPI-Cards selbst (nur Verschieben).
