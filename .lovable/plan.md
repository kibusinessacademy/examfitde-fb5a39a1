
# Post-Publish Growth Orchestration v1 — Umsetzungsplan

Der Superprompt umfasst 8 Phasen mit ~40 neuen Artefakten (Migrationen, Edge Functions, Crons, RPCs, Cockpit-Cards, Tests). Das ist zu groß für einen Loop. Ich schlage eine **Drei-Wellen-Strategie** vor, mit klaren Quality-Gates zwischen den Wellen.

## Welle 1 (P0 — sofort, dieser Loop)

Schließt die kritischsten Lücken aus dem Audit:

1. **Phase 1 — Fanout-Trigger** `trg_fn_post_publish_growth_fanout()` 
   - feuert nur bei echtem `draft/queued/building → published`-Übergang + `is_published=true`
   - enqueued idempotent 9 Jobs via `ops_job_type_registry` (neue job_types vorher registrieren)
   - Idempotency-Key: `post_publish_growth:{package_id}:{job_type}`
   - Insert `conversion_events.event_type='package_published'` (mit `package_id`, `curriculum_id`, `persona`)
   - Audit `auto_heal_log` action_type=`post_publish_growth_fanout`
   - **Kollisionscheck**: bestehende Trigger `trg_auto_publish_seo_pages` + `trg_seo_pages_auto_publish_on_package` → ein Duplikat löschen, anderer bleibt für SEO-Pages-Status-Flip (anderer Concern)

2. **Phase 2 — Sitemap + IndexNow Verkabelung**
   - Recon zuerst: welche Edge Functions (`generate-sitemap`, `seo-submit-indexnow`, `seo-retry-failed-submissions`) existieren?
   - Bestehende verkabeln, fehlende minimal ergänzen
   - 2 Crons: `seo-indexnow-submit-30min`, `seo-retry-failed-submissions-15min`
   - Submit-Log-Tabelle nur falls nicht vorhanden

3. **Phase 3 — Funnel Tracking P0 Fix** (Tracking-Drift 26 paid → 1 checkout_complete, 0 pricing_view)
   - `pricing_view` auto-fire auf Pricing-Detail-Routes (nutzt vorhandenen `useTrackPageView`)
   - CTA-Klick auf Pricing/Checkout → `checkout_started`
   - Stripe webhook `purchase_completed` Parität prüfen
   - Pflichtfelder: `package_id`, `curriculum_id`, `persona`, `source_page`, `page_path`
   - View `v_funnel_event_loss` + Cron `funnel-loss-detect-hourly` mit Alarm <95% Parität

4. **Phase 8 (Welle 1 Subset)** — minimaler Smoke-Test:
   - Publish enqueued alle 9 Jobs genau einmal
   - Re-Publish erzeugt keine Duplikate
   - Insert in `auto_heal_log` korrekt

## Welle 2 (P1 — Folge-Loop)

5. **Phase 4** — Blog + Distribution Verkabelung pro Paket (Worker-Recon zuerst)
6. **Phase 5** — Email Sequence Enrollment (Job + Detector, Opt-in respektieren)
7. **Phase 7** — Self-Heal Detectors (Views + Crons für 9 Drift-Klassen)

## Welle 3 (P2 — Cockpit + Tests)

8. **Phase 6** — 8 Cockpit-Cards (Admin-RPCs, read-only)
9. **Phase 8 Vollumfang** — Regression-Tests + CI-Guards

---

## Technische Details Welle 1

### Neue Job-Types (in `ops_job_type_registry` registrieren)
```text
seo_sitemap_regen          (lane: seo,        requires_package_id: false, is_governance: false)
seo_indexnow_submit        (lane: seo,        requires_package_id: true)
package_post_publish_blog  (lane: content,    requires_package_id: true)
seo_internal_links_rebuild (lane: seo,        requires_package_id: false)
package_og_image_generate  (lane: content,    requires_package_id: true)
package_distribution_plan  (lane: marketing,  requires_package_id: true)
package_campaign_assets_generate (lane: marketing, requires_package_id: true)
package_email_sequence_enroll    (lane: marketing, requires_package_id: true)
```
(`package_auto_generate_seo_suite` existiert bereits)

### Trigger-Kontrakt
```text
AFTER UPDATE OF status, is_published ON course_packages
WHEN (NEW.status='published' AND NEW.is_published=true
      AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_published IS DISTINCT FROM NEW.is_published))
```
Anti-Doppel-Trigger durch `EXISTS (job_queue WHERE correlation_id = idempotency_key AND status IN ('queued','processing'))`-Check pro Job.

### Funnel-Loss-View
```sql
v_funnel_event_loss:
  paid_orders_24h, checkout_complete_24h, pricing_view_24h,
  parity_pct = checkout_complete / paid_orders,
  status = CASE WHEN parity_pct < 0.95 THEN 'CRIT' WHEN <0.99 THEN 'WARN' ELSE 'OK' END
```
Cron loggt jede Stunde in `auto_heal_log` (auch noop) → respektiert `mem://architektur/ops/data-holes-ssot-v1`.

### Verbotsregeln (aus Memory)
- Keine `text-white`/`bg-X/10` in Cockpit-Cards (Welle 3) — Tokens
- Admin-Views: `REVOKE FROM PUBLIC,authenticated` + nur via SECURITY DEFINER RPC mit `has_role`
- COUNT(*) statt COUNT()
- `package_id` als Top-Level-Spalte in `conversion_events` nutzen (generated column existiert)
- Bronze-Lock-Guard respektiert (Trigger blockt nur council/auto_publish/integrity, NICHT die neuen Growth-Jobs — Growth darf auch auf Bronze laufen)
- `bronze_lock_override` NICHT setzen (nicht relevant)
- Migration-Discipline: Schema introspecten, ein Concern pro Migration, Smoke + Rollback-Hint

### Migrationen Welle 1 (4 Stück, getrennt)
1. `growth_fanout_register_job_types` — 8 neue Einträge in `ops_job_type_registry`
2. `growth_fanout_trigger_v1` — Funktion + Trigger + Helper `fn_growth_idempotency_key`
3. `growth_fanout_dedupe_legacy_seo_trigger` — eines der zwei Duplikat-Trigger droppen
4. `funnel_loss_view_and_cron` — `v_funnel_event_loss` + RPC + cron job

### Frontend-Fixes Welle 1 (sehr klein)
- `useTrackPageView` deckt `/pricing` schon ab → prüfen ob Pricing-Detail-Routen matchen, ggf. erweitern
- Pricing-Detail-Page: explizit `pricing_view` mit `package_id`/`persona` (statt nur Path)
- Checkout-CTAs: `checkout_started` Event-Konsistenz

---

## Was NICHT in dieser Welle passiert
- Keine neuen Cockpit-Cards (Welle 3)
- Keine Email-Enrollment-Logik (Welle 2)
- Kein Blog-Generation-Worker (Welle 2)
- Kein vollständiger Test-Suite-Aufbau (Welle 3)

---

## Risiken & Rollback
- **Risiko 1**: Trigger feuert auf Bestand wenn Pakete `UPDATE`d werden ohne Statusänderung → durch `IS DISTINCT FROM`-Guard abgesichert
- **Risiko 2**: Job-Queue-Flut bei Backfill → Welle 1 macht KEINEN Backfill der bereits 49 published Pakete; separater opt-in RPC `admin_backfill_post_publish_growth(package_id)` für gezielten manuellen Trigger
- **Rollback**: jede Migration reverse-Hint im Header (`DROP TRIGGER`, `DELETE FROM ops_job_type_registry WHERE ...`)

---

**Bestätige bitte**, dass ich mit **Welle 1 (Phasen 1–3 + Smoke)** starte. Welle 2 + 3 als separate Loops.
