# Frühwarn-Guards: Reconciler-Explosion & Stale-Lock-Rotation

## Umgesetzt: 2026-04-10

### Guard 1 — Reconciler-Explosion (`fn_guard_reconciler_explosion`)
- **Cron alle 10 Minuten** (`guard-reconciler-explosion`)
- Erkennt Steps mit `status=failed` + ≥5 completed Jobs desselben Typs in 6h
- Nur für Pakete im Status `building`
- **Maßnahme**: Step → `queued`, Meta-Flag `reconciler_explosion_healed`, Admin-Warning (2h Dedup)
- **Motivation**: Fachinformatiker MiniCheck-Explosion (Reconciler materialisiert Jobs für failed Steps)

### Guard 2 — Stale-Lock-Rotation (`fn_guard_stale_lock_rotation`)
- **Cron alle 10 Minuten** (`guard-stale-lock-rotation`)
- Erkennt Jobs mit `status=processing` + `attempts>=3` + `STALE_LOCK_RECOVERY` im last_error + >30min ohne Update
- **Maßnahme**: Job → `failed`, Step-Meta-Flag, kritische Admin-Notification (2h Dedup)
- **Motivation**: Wirtschaftsinformatik QC-Job rotierte ohne Fortschritt

### Komplementär zu
- `trg_guard_stale_lock_loop` (synchroner Trigger, greift bei attempts>=5)
- `fn_guard_ghost_finalization` (Ghost-Steps ohne started_at)
- Poison-Loop Guard (F-5, Generators vor Enqueue)
