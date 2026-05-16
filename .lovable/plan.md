## Ausgangslage

`fn_post_publish_growth_fanout` (Trigger `trg_post_publish_growth_fanout`) existiert und fanou-t bereits 9 Growth-Jobs bei `status='published' AND is_published=true`. Außerdem laufen `trg_post_publish_seo_suite`, `trg_post_publish_learner_e2e`, `trg_auto_publish_seo_pages`, plus Health/Repair/Backfill-RPCs und Worker `post-publish-growth-worker`.

**Was bereits fanou-ed wird:** `package_auto_generate_seo_suite, seo_sitemap_refresh, seo_indexnow_submit, package_post_publish_blog, seo_internal_links, package_og_image_generate, package_distribution_plan, package_campaign_assets_generate, package_email_sequence_enroll`.

**Was fehlt** (Commerce-Gate + Repair-Branching):
- `commerce_product_visibility_check`
- `commerce_price_activation_check`
- `commerce_sellability_gate_check`
- `commerce_audit_snapshot`
- Repair-Jobs: `commerce_repair_product_missing`, `commerce_repair_price_missing`, `commerce_repair_lesson_gate_failed`
- SEO-Backlog-Expand und CRM-Sync sind **bewusst nicht** im Trigger-Fanout, sondern werden vom Sellability-Gate gated: nur sellable=true triggert `seo_backlog_expand_one` und `crm_product_sync`. Verhindert SEO-Output ohne Kaufpfad (Memory: aktuelle 9-vs-25-Befund).

→ **Kein Parallel-Orchestrator** (SSOT/Migration-Discipline). Stattdessen: Commerce-Gate-Sub-Fanout in die bestehende Growth-Fanout-Funktion + drei Gate-Checker-Funktionen + Repair-Branching + SSOT-View + E2E-Smoke.

## Architektur

```text
status→published
     │
     ▼
fn_post_publish_growth_fanout  (extend)
     ├─ existing 9 growth jobs ……………… unverändert
     └─ commerce gate fanout (NEU):
           commerce_product_visibility_check ─── FAIL ──► commerce_repair_product_missing
           commerce_price_activation_check ───── FAIL ──► commerce_repair_price_missing
           commerce_sellability_gate_check ───── PASS ──► seo_backlog_expand_one + crm_product_sync
                                                └─ FAIL ──► commerce_repair_lesson_gate_failed
           commerce_audit_snapshot ───────────── always last
```

Idempotenz: bestehende Form `commerce:<pkg_id>:<job_type>` als `idempotency_key`. Repair-Jobs hängen `:<reason>` an.

## Phasen (jede Phase ist ein Concern, eine Migration)

### Phase 1 — Registry + SSOT-View
- Migration: 7 neue `ops_job_type_registry`-Rows (4 gate + 3 repair) mit `lane='control'`, `pool='control'`, `requires_package_id=true`, `is_governance=true`.
- View `v_post_publish_commerce_status_ssot`: pro published Package → `product_public, has_stripe_price, lesson_ready, is_sellable, gate_state ('PASS'|'PRODUCT_MISSING'|'PRICE_MISSING'|'LESSON_GATE_FAILED'|'NOT_SELLABLE')`. REVOKE FROM PUBLIC, GRANT service_role only.
- RPC `admin_get_post_publish_commerce_status(p_limit, p_state)` mit `has_role('admin')`-Gate.
- Smoke-SQL: 49 published → state-distribution. Audit `auto_heal_log action_type='commerce_gate_ssot_baseline'`.

### Phase 2 — Gate-Check-Funktionen (Handler-RPCs)
SECURITY DEFINER, service_role only. Werden vom Worker aufgerufen (kein Edge-Code-Touch in Phase 2):
- `fn_commerce_product_visibility_check(p_package_id)` → PASS/FAIL, enqueued repair job bei FAIL (mirror via `job_queue` mit `enqueue_source='commerce_gate'`), Audit.
- `fn_commerce_price_activation_check(p_package_id)` analog.
- `fn_commerce_sellability_gate_check(p_package_id)` (kombiniert `v_public_sellable_courses` per curriculum_id). PASS → enqueued `seo_backlog_expand_one` + `crm_product_sync` mit `wave_tag='post_publish_auto_<pkg_id>'`. FAIL → Repair-Branch passend zur Reason.
- `fn_commerce_audit_snapshot(p_package_id)` schreibt eine Row in `auto_heal_log` mit allen Flags.

Jede Funktion idempotent + retryable + audit-loggt. Bronze-Lock-Override nicht nötig (nicht Council-Pfad).

### Phase 3 — Worker-Wiring
Edge-Function `post-publish-growth-worker` existiert bereits. Erweitern um Dispatch der 7 neuen `job_type`s → ruft die Phase-2-RPCs auf. Deploy direkt nach Code-Push (Memory: Deploy edge functions immediately).

### Phase 4 — Fanout-Extension
Migration: `fn_post_publish_growth_fanout` um 4 commerce-gate-Jobs erweitern (nicht die Repair-Jobs — die entstehen reaktiv aus Gate-FAIL). Idempotency-Key-Prefix bleibt `post_publish_growth:`.

### Phase 5 — Repair-Job-Allowlist
Migration: Erweiterung des bestehenden `fn_guard_bronze_lock_on_job_enqueue`-Pendants ist nicht nötig (Commerce-Pfad nicht Bronze-gated). Aber: Pflicht-Allowlist für `enqueue_source='commerce_gate'` in jeder Stelle, die fanout-Jobs blockiert (Audit-Check, keine Mutation falls bereits passive).

### Phase 6 — E2E-Smoke
Script `scripts/e2e/commerce-fanout-smoke.mjs`:
1. Pick 3 published Pakete: 1 sellable, 1 lesson-gate-fail, 1 ohne Product.
2. Trigger Re-Fanout via `admin_backfill_post_publish_growth` für jedes.
3. Erwarte pro Paket 13 Jobs enqueued (9 alt + 4 commerce gate).
4. Worker laufen lassen (claim) und Gate-States validieren gegen `v_post_publish_commerce_status_ssot`.
5. Erwarte: Sellable-Paket hat zusätzlich `seo_backlog_expand_one`-Row in `seo_content_priority_queue`. Lesson-Gate-Fail-Paket hat `commerce_repair_lesson_gate_failed`-Job. Product-missing analog.
6. Audit-Schreibung in `auto_heal_log` für alle Steps.
7. CI-Workflow `.github/workflows/commerce-fanout-smoke.yml` (PR-Gate).

### Phase 7 — Memory + Doc
- Memory-File `mem://architektur/marketing/post-publish-commerce-gate-fanout-v1.md` (state-machine, job-types, repair-mapping, SSOT-View).
- Update `mem://index.md` Memories-Liste.
- Update `docs/LAUNCH_READINESS.md` Sektion „Verkaufbarkeitsregel“ → Link zur Commerce-Gate-SSOT.

## Abgrenzungen (was diese Iteration NICHT macht)

- **Keine** automatische Erzeugung von Products/Prices/Lessons. Gate-Checks enqueuen Repair-Jobs als Signal; tatsächliche Pricing-/Content-Erzeugung bleibt manueller Admin-Pfad (Risiko Stripe-Side-Effects).
- **Keine** Persona-Expansion (umschueler bleibt off-limits).
- **Keine** Änderung an bestehenden 9 Growth-Jobs oder am Worker-Auto-Heal-Pfad.

## Rollback-Hints

- Migration 4 (Fanout-Extension): `CREATE OR REPLACE FUNCTION` zurück auf vorherige 9-Job-Liste — Schema-Snapshot im PR.
- Migration 1 (Registry): `UPDATE ops_job_type_registry SET is_active=false WHERE job_type LIKE 'commerce\_%'`.
- Repair-Jobs in `job_queue` cancellbar via `admin_run_post_publish_growth_repair` mit `mode='cancel'`.

## Aufwand (Schätzung)

- 4 Migrationen (Registry, View+RPC, Gate-RPCs, Fanout-Extension)
- 1 Edge-Function-Update + Deploy
- 1 Smoke-Script + 1 CI-Workflow
- 1 Memory-File + Index-Update

**Bestätigung benötigt vor Implementierung:**
1. Commerce-Gate ist Hard-Block (kein SEO/CRM bei NOT_SELLABLE) — korrekt?
2. `seo_backlog_expand` läuft nur auf sellable=true via Gate, nicht im Trigger-Fanout — korrekt?
3. Repair-Jobs sind Signal-only (kein Auto-Pricing/Auto-Lesson-Generation) — korrekt?
