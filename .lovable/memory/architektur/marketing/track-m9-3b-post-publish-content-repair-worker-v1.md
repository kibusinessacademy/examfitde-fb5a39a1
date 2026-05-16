---
name: Track M9.3b Post-Publish Content-Repair Worker v1
description: Dedizierter Worker für content_gap_published_locked. Bypasst Pipeline-Guards (OPS_GUARD/Phantom-Step) UND guard_sealed_course via narrow per-session app-Flag. Idempotent (idempotency_key=m9_3b:<pkg>:<repair_type>), WIP-Cap 10, Cron 5min. Audit action_type=post_publish_content_repair_{lessons|scaffold}.
type: feature
---

## Komponenten

- **Job-Typen** (in `ops_job_type_registry` + `job_type_policies` whitelisted, `can_run_when_not_building=true`, `exempt_from_auto_cancel=true`):
  - `post_publish_content_repair_lessons` — flippt lessons mit Inhalt → status='ready', generation_status='completed'
  - `post_publish_content_repair_scaffold` — deferred handler (noop_reason='scaffold_deferred_pending_m9_3c_blueprint_input')
- **RPC `admin_m9_post_publish_repair_dispatch(p_limit, p_dry_run)`** (admin only)
  - Quelle: nur `gap_class='content_gap_published_locked'`
  - Idempotency: skip wenn aktiver Job mit gleichem `idempotency_key` (`m9_3b:<pkg>:<type>`)
  - WIP-Cap: max 10 in-flight Jobs der beiden Typen kombiniert
  - Dry-Run-Modus standardmäßig
- **Helper `fn_m9_repair_lessons_for_package(uuid)`** (service_role only)
  - Setzt narrow `app.m9_3b_allow_sealed_lessons_repair=on` (LOCAL=true)
  - `guard_sealed_course` ehrt das Flag NUR für `TG_TABLE_NAME='lessons' AND TG_OP='UPDATE'` (jeder andere Schreibweg auf sealed bleibt blockiert)
  - Direkt-UPDATE auf lessons; kein Touch von `package_pipeline_steps`
- **Edge Function `post-publish-content-repair-worker`**
  - Drain ≤10 Jobs/Tick, atomic claim, per-Outcome Audit
  - Niemals silent-fail (Outcome ∈ {completed, noop, failed})
- **Cron `post-publish-content-repair-worker-5min`** (jobid 269, `*/5 * * * *`)
- **UI** `TrackM9StatusCard`: Buttons „M9.3b Dry-Run (10)" + „M9.3b Repair (10)"

## Bypass-Pattern (wiederverwendbar)

`guard_sealed_course` honoriert ein per-Session `app.m9_3b_allow_sealed_lessons_repair='on'` Flag (LOCAL=true, stirbt mit Transaktion). Nur die SECURITY-DEFINER Repair-Funktion setzt es. Keine `session_replication_role`-Manipulation nötig (würde Superuser erfordern).

## Scope-Grenzen

- Lessons-Handler: nur lessons mit non-leerem `content` werden geflippt
- Scaffold-Handler: bewusst noop (5 published Pakete ohne Modules brauchen Blueprint-Input → M9.3c)
- Keine Berührung von `package_pipeline_steps`, kein normales Pipeline-Re-Entry

## Smoke 2026-05-16

Manuell enqueued + Worker invoked: Bankkaufmann (course `17cb9a64-…`) → 600 lessons_flipped, gap_class kippt von `content_gap_published_locked` → `sellable`. Total: 173 → 174 sellable, 17 → 16 locked.

## Akzeptanz

- [x] Nur `content_gap_published_locked` als Source
- [x] Keine Pipeline-Jobs/Steps berührt
- [x] Idempotent pro `package_id + repair_type`
- [x] WIP-Cap 10
- [x] Audit `post_publish_content_repair_*` für jeden Outcome
- [x] Dry-Run-Pfad im RPC + Cockpit-Button
- [x] OPS_GUARD/Phantom-Step-Guard unberührt
- [~] 12/17 lessons-repair erreichbar via M9.3b; 5/17 scaffold benötigen M9.3c

## Rollback

```sql
SELECT cron.unschedule('post-publish-content-repair-worker-5min');
DELETE FROM job_type_policies WHERE job_type IN ('post_publish_content_repair_lessons','post_publish_content_repair_scaffold');
DROP FUNCTION IF EXISTS public.admin_m9_post_publish_repair_dispatch(integer, boolean);
DROP FUNCTION IF EXISTS public.fn_m9_repair_lessons_for_package(uuid);
-- guard_sealed_course Bypass-Klausel entfernen (revert auf vorherige Version).
```
