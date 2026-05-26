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

**Cron:** noch NICHT aktiviert. Aktivierung erst nach Live-Execute + Beobachtung 24h. Vorgesehen: 10-Min-Tick analog v1.

**Co-Existenz mit v1:** v1 bleibt aktiv (deckt anderen Verdict-Pfad inkl. BRONZE_REVIEW_CLEAN). v2 ist strikt orthogonal (bronze_locked=false hard). Kein Doppel-Enqueue, da beide identischen `NOT EXISTS active job_queue`-Guard nutzen.

**Sale-Impact:** Hebt 9 der 48 publish-blocked Pakete sofort über den Tail-Step in Richtung published. Verbleibende 39 sind bronze_locked und brauchen Repair-Loop (Bronze Targeted Repair v1+v2) oder expliziten Per-Paket-Override.
