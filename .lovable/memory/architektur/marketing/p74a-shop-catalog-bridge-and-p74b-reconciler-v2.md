---
name: P74a Shop-Katalog-Bridge & P74b Reconciler v2
description: Customer-Catalog für alle sellable Courses + bronze-strikter Tail-Step-Reconciler über building+done
type: feature
---

# P74a — Shop-Katalog-Bridge (live 2026-05-26)

**Zweck:** Die 190 sellable Courses im Customer-Shop sichtbar machen, ohne die Bundle-Sektion (store_products) abzulösen.

**SSOT:** `v_public_sellable_courses` (is_sellable=true). Bridge-RPC `public_sellable_course_catalog()` (SECURITY DEFINER, granted to anon+authenticated) joined zu `course_packages` + `certification_catalog` für Kammer/Track/Beruf-Metadata.

**Frontend:**
- Hook: `src/hooks/useSellableCourses.ts`
- Card: `src/components/shop/SellableCoursesCatalog.tsx`
- Integration: `src/pages/ShopPage.tsx` rendert Bundle-Sektion (legacy `useShopProducts` über `store_products`) **plus** neue Kurs-Katalog-Sektion.
- Filter: Suche, Kammer, Prüfungstyp, Track, 4 Preis-Buckets.
- CTAs: „Prüfung starten" / „Prüfung simulieren" (existing `product_select` Tracking).

**Drift-Prevention (P73.5):** Keine internen Begriffe (Curriculum, Council, Bronze, Score) in Customer-UI.

---

# P74b — Reconciler v2 (live 2026-05-26, Dry-Run-Smoke green)

**Root-Cause:** v1-Reconciler (`admin_reconcile_queued_tail_without_job`) deckte nur `status='building'` ab und mixte BRONZE_REVIEW-Klassen ein. Pakete in `status='done'` mit hängendem `auto_publish` blieben unsichtbar.

**Scope v2 (strikt):**
- `course_packages.status IN ('building','done')`
- `approved_questions >= 50`
- `fn_is_bronze_locked(package_id) = false` (SSOT, kein Default-Bypass)
- Tail-Step IN (`run_integrity_check`, `quality_council`, `auto_publish`) mit `status IN ('queued','blocked')`
- Kein aktiver `job_queue`-Job für das Paket
- 5-Min-Cooldown via `fn_tail_heal_package_cooldown_active`

**SSOT-Objekte:**
- View `v_queued_tail_without_job_v2` (read-only, service_role only)
- RPC `admin_reconcile_queued_tail_without_job_v2(p_dry_run boolean DEFAULT true, p_limit int DEFAULT 50, p_override_package_ids uuid[] DEFAULT NULL, p_override_reason text DEFAULT NULL)` — SECURITY DEFINER + has_role-Gate, EXECUTE nur service_role.

**Bronze-Bypass:** kein Default. Nur per expliziter `p_override_package_ids[]` plus `p_override_reason >= 5 chars`. Override schreibt zusätzlich `queued_tail_reconciler_v2_override` (mit Begründung).

**Repair-Pfad:** Governance-konform — schreibt in `job_queue` mit `enqueue_source='queued_tail_reconciler_v2'`, kein Direkt-Publish, kein Status-Skip. Tail-Step läuft regulär über bestehende Worker.

**Audit (ops_audit_contract registriert):**
- `queued_tail_reconciler_v2` (Pflicht: package_id, step_key, package_status)
- `queued_tail_reconciler_v2_error`
- `queued_tail_reconciler_v2_override` (Pflicht: package_id, step_key, reason)
- `queued_tail_reconciler_v2_run_summary` (dry_run, candidates, enqueued, skipped)

**Baseline 2026-05-26 (Dry-Run):** 10 Kandidaten — 9 building + 1 done. Range: 62–1073 approved Q. Top: `fachinformatiker_digitale_vernetzung__ausbildung_voll` (1073 Q, integrity), `industriemeister_metall_ihk__exam_first_plus` (1030 Q, auto_publish). 0 Override.

## P74b.1 — View-Härtung + Cron-Aktivierung (2026-05-26)

**View-Härtung:** `v_queued_tail_without_job_v2` filtert zusätzlich auf `NOT EXISTS package_steps` mit `status IN (queued, processing, blocked)` außer dem Tail-Step selbst. Eliminierte 4 Silent-Drops aus Live-Execute (energiefachwirt, datenschutzbeauftragter, finanzanlagenvermittler, kaufmann_fuer_bueromanagement). Verbleibend nur echte enqueue-fähige Tail-Kandidaten.

**Cron live (2026-05-26):** `queued-tail-reconciler-v2-10min` (jobid 283), `*/10 * * * *`, Command `SELECT public.fn_queued_tail_reconciler_v2_cron_tick()`.

**Wrapper `fn_queued_tail_reconciler_v2_cron_tick()`** (SECURITY DEFINER, service_role only):
- `pg_try_advisory_lock(hashtextextended('queued_tail_reconciler_v2_cron_tick', 0))` gegen Parallel-Läufe (Skip → Audit mit `lock_acquired=false`)
- Ruft `admin_reconcile_queued_tail_without_job_v2(p_dry_run:=false, p_limit:=25, overrides:=NULL)`
- Pflicht-Audit `queued_tail_reconciler_v2_cron_tick` bei jedem Tick (auch no-op) — required_keys: `ran, enqueued, candidates, elapsed_ms`
- EXCEPTION-Pfad emittiert Audit mit `error`-Feld vor RAISE; Advisory-Lock wird in beiden Pfaden freigegeben

**Co-Existenz mit v1:** v1 bleibt aktiv (deckt BRONZE_REVIEW_CLEAN-Pfad). v2 strikt orthogonal (bronze_locked=false hard). Kein Doppel-Enqueue durch identischen `NOT EXISTS active job_queue`-Guard + 5-Min `fn_tail_heal_package_cooldown_active`.

**Sale-Impact:** Hebt automatisch enqueue-fähige Tail-Pakete (kein bronze_lock) über integrity → council → auto_publish Richtung published. Bronze-locked Pakete brauchen weiterhin Repair-Loop oder Per-Paket-Override mit Audit-Begründung.
