# Dauermaßnahme: Zombie-No-Op-Job Guard

## Umgesetzt: 2026-04-12

### Problem
Jobs für Steps, die bereits als abgeschlossen signalisiert sind (remaining=0, ok+batch_complete=true),
bleiben als pending/processing in der Queue. Da sie als T1_GEN (45s Budget) klassifiziert sind,
werden sie wegen BUDGET_EXHAUSTED nie dispatched → Self-Finalization kann nie feuern →
count_active_jobs meldet weiter "aktiv" → FINALIZATION_RULES blockiert → Deadlock.

### Lösung
`fn_cancel_zombie_noop_jobs()` — aufrufbar per Cron oder manuell:
- Erkennt MiniCheck-Jobs mit `remaining_targets_after = 0`
- Erkennt Handbook-Jobs mit `ok = true AND batch_complete = true`
- Storniert diese No-Op-Jobs mit `ZOMBIE_NOOP_GUARD` Marker
- Logging in `auto_heal_log`

### Kausalkette die verhindert wird
```
Step-Meta signalisiert fertig
→ Neuer Job wird erzeugt (Scheduler)
→ Job ist T1_GEN (45s Budget)
→ BUDGET_EXHAUSTED (nie genug Slot)
→ Job bleibt pending
→ count_active_jobs > 0
→ FINALIZATION_RULES feuern nicht
→ Step bleibt queued
→ Scheduler erzeugt neuen Job
→ Loop
```

### Invarianten
- Guard ist idempotent und kann beliebig oft aufgerufen werden
- Nur Jobs storniert, deren Step noch nicht done/skipped ist
- Audit-Trail in auto_heal_log
