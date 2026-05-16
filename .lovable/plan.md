## Post-Purchase Delivery Assurance v1

Brücke von `paid` → `delivered`. Kein bezahlter Kauf darf >2 Min ohne aktives Learner-Entitlement und verifizierten Kurszugriff bleiben.

### Scope (P0, minimal)

**1. Delivery-Readiness SSOT (extends Sellability-Gate)**

`v_course_delivery_readiness` (service_role only):
- `course_package_id`, `product_id`, `curriculum_id`
- `has_lessons`, `lessons_ready_count`, `lessons_total_count`
- `minichecks_ready` (≥1 approved minicheck per lesson), `exam_trainer_ready` (≥approved-Pool-Threshold)
- `tutor_context_ready` (RAG-Index vorhanden), `oral_exam_ready`, `h5p_assets_ready`, `storage_assets_accessible`
- `delivery_ready` bool, `blocking_reasons text[]`

Erweitert `v_post_publish_readiness` um Delivery-Spalten → neues SSOT `v_sellable_and_deliverable`:
`sellable = commerce_ready AND delivery_ready` (harte Regel, ersetzt rein-Stripe-basierte Prüfung).

**2. learner_entitlements (neue SSOT-Tabelle, falls noch nicht kanonisch)**

Bestehende Tabellen `entitlements` + `learner_course_grants` prüfen; bei Bedarf neue View `v_learner_entitlements_ssot` mit Pflichtfeldern:
`id, buyer_user_id, learner_user_id, product_id, package_id, license_id, status (pending|active|blocked|revoked|failed), access_scope jsonb, activated_at, last_verified_at, blocking_reason`.

Buyer/Learner-Trennung explizit (B2B-fähig).

**3. v_my_active_entitlements** — RLS: nur eigene Zeilen (`learner_user_id = auth.uid()`). Frontend-API ausschließlich hierüber.

**4. Post-Purchase Delivery Orchestrator**

Trigger auf `orders.status='paid'` (idempotent, bestehender `trg_orders_paid_grant` wird erweitert):
Fanout in `job_queue`:
- `post_purchase_entitlement_create`
- `post_purchase_license_assign`
- `post_purchase_course_access_verify`
- `post_purchase_feature_access_verify` (h5p, tutor, oral, exam)
- `post_purchase_first_lesson_probe`
- `post_purchase_delivery_audit_snapshot`

Erst wenn alle grün → `delivery_status = 'confirmed'` auf `orders` + Audit `auto_heal_log.action_type='post_purchase_delivery'`.

Registrierung in `ops_job_type_registry` (lane=`commerce`, requires_package_id=true).

**5. Worker**

Neue Edge `post-purchase-delivery-worker` (oder Erweiterung `post-publish-growth-worker`) mit RPC-Handlern für die 6 Job-Typen. Jeder Handler ruft eine `SECURITY DEFINER` Funktion `fn_post_purchase_*_check(order_id, learner_id)`.

**6. SLA-Wächter (2-Min-Regel)**

`fn_detect_post_purchase_delivery_sla_breach(p_minutes int default 2)`:
findet `orders.status='paid'` ohne `delivery_status='confirmed'` >2 Min → enqueued Audit + (falls möglich) Auto-Repair.
Cron `post-purchase-delivery-sla-2min` alle 2 Min.

**7. Admin-Cockpit Card**

`PaidButNotDeliveredCard.tsx` im HealCockpit Diagnostics-Tab:
- Counter pro Status (pending/blocked/failed)
- Top-N offene Orders mit `blocking_reason`
- Buttons: Repair Order / Repair Entitlement

**8. Auto-Repair RPCs (service_role + admin-RPC-Wrapper)**

- `admin_repair_purchase_delivery(p_order_id uuid)` → re-enqueued kompletten Fanout
- `admin_repair_learner_entitlement(p_entitlement_id uuid)` → revalidate + reactivate
- Mapping pro Blocking-Reason → spezifischer Repair-Job (entitlement_missing, license_unassigned, access_denied, lesson_unready, h5p_missing, tutor_missing, exam_pool_empty, stripe_paid_app_failed=CRITICAL_ALERT)

**9. Checkout-Gate verschärfen**

`create-product-checkout` prüft jetzt `v_sellable_and_deliverable.is_sellable_and_deliverable=true` statt nur `has_stripe_price`. Bei Fail: 422 + Audit `checkout_blocked_not_deliverable`.

**10. Memory & Doku**

- Memory-Leaf `architektur/marketing/post-purchase-delivery-assurance-v1.md`
- Update License-Loop-C Bridge Memory (Verweis)
- `package_license_template_prepare` als **v1-placeholder-noop** im Orchestrator-Memory klar markieren.

### Reihenfolge (in dieser Migration-Discipline-konformen Order)

1. Schema-Introspect (entitlements, learner_course_grants, orders, lesson tables, h5p assets) — eigener Read-Only-Pass
2. Migration A: `v_course_delivery_readiness` + `v_sellable_and_deliverable`
3. Migration B: `learner_entitlements` (falls neu) + `v_my_active_entitlements` + RLS
4. Migration C: 6 neue Job-Typen in `ops_job_type_registry` + Fanout-Trigger-Erweiterung
5. Migration D: 6 `fn_post_purchase_*_check` RPCs + `fn_detect_post_purchase_delivery_sla_breach`
6. Edge: `post-purchase-delivery-worker` (RPC-handler-factory wie bei Orchestrator v1.1)
7. Cron: 2-Min SLA (via insert tool, projekt-spezifisch)
8. Migration E: `admin_repair_purchase_delivery` + `admin_repair_learner_entitlement`
9. UI: `PaidButNotDeliveredCard` + HealCockpit-Integration
10. Edge-Update: `create-product-checkout` Gate verschärfen
11. Memory + Doku
12. Smoke: `b2c-ssot-server-smoke.mjs` erweitern um Delivery-Check-Assertion

### Akzeptanzkriterien

- Kein `orders.status='paid'` >2 Min ohne `delivery_status='confirmed'` ODER ein gemeldeter `blocking_reason` mit Repair-Job.
- `v_my_active_entitlements` ist einzige Frontend-API für Zugriffsprüfung.
- `sellable = commerce_ready AND delivery_ready` durchgesetzt im Checkout.
- Smoke grün (single+bundle+refund+delivery-probe).

### Offene Frage vor Implementierung

Eine kurze Klärung, dann ziehe ich durch:

**Soll `learner_entitlements` als neue Tabelle eingeführt werden, oder reicht eine konsolidierende SSOT-View `v_learner_entitlements_ssot` über die bestehenden `entitlements` + `learner_course_grants` (Loop-C-Bridge v2)?**

Empfehlung: **View first**, neue Tabelle nur wenn buyer_id/learner_id-Split in den bestehenden Tabellen nicht abbildbar ist. Das vermeidet Schema-Drift und Doppel-SSOT.
