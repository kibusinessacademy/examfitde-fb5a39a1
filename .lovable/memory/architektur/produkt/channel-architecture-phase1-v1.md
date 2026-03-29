# Memory: architektur/produkt/channel-architecture-phase1-v1
Updated: 2026-03-29

## Prinzip
Ein Produkt – mehrere Kanäle – eine Berechtigungswahrheit.
Kanäle: Web, LTI, SCORM, iOS App, Android App.

## Phase 1: Product + Entitlement Foundation (✅ umgesetzt)

### Erweiterte Tabellen

**products** (ehemals Curriculum-Router, jetzt Produkt-Katalog):
- Neue Spalten: title, subtitle, description, product_type, curriculum_id, status, visibility, channel_policy_json
- Bestehende Spalten (backward-compat): slug, certification_id, active_package_id
- product_type: course | exam_trainer | oral_trainer | bundle | micro_course
- status: draft | active | retired | archived

**entitlements** (in-place erweitert):
- Neue Spalten: product_id (→ products.id), org_id, learner_identity_id, source_type, source_ref, seat_scope, metadata_json
- Bestehende Feature-Flag-Spalten bleiben: has_learning_course, has_exam_trainer, has_ai_tutor, has_oral_trainer, has_handbook
- source_type: web_purchase | apple_iap | google_play | lti_deployment | admin_grant | coupon | b2b_license | scorm_export_access
- Dual-Mode: Alte Feature-Flags UND neues product_id-System koexistieren

### Neue Tabellen

**product_versions**: Versionierte Produkt-Snapshots (version_tag, is_current, status: draft/frozen/released/deprecated)

**product_artifact_mappings**: Verbindet Produktversionen mit SSOT-Artefakten (lesson, exam_pool, oral_pack, handbook, tutor_context etc.)

**product_channel_configs**: Steuert Kanalverfügbarkeit pro Produkt (web/lti/scorm/ios_app/android_app, is_enabled, availability_mode)

**learner_identities**: Kanalübergreifende Lerner-Identitäten (native/lti/invited/anonymous_exam/mobile_only, external_subject_hash)

**org_licenses**: Organisationslizenzen (seat_count, starts_at/ends_at, contract_ref)

**org_license_assignments**: Seat-Zuweisung an learner_identities

### Zentrale Funktion
`can_access_product(p_user_id, p_product_id)` — SECURITY DEFINER, prüft Entitlements inkl. learner_identities-Auflösung.

### RLS-Strategie
- product_versions, product_artifact_mappings, product_channel_configs: Lesen für authenticated
- learner_identities: Nur eigene (user_id = auth.uid())
- org_licenses: Über learner_identity → org Zugehörigkeit
- org_license_assignments: Nur eigene Zuweisungen

## Beziehungsmatrix (Ist-Stand nach Phase 1)

```
products (Katalog)
  ├── product_versions → product_artifact_mappings → SSOT-Artefakte
  ├── product_channel_configs (web/lti/scorm/ios/android)
  ├── org_licenses → org_license_assignments → learner_identities
  └── entitlements (product_id) → user_id / learner_identity_id

store_products (Commerce/Pricing — Stripe)
  ├── platform_skus (iOS/Android SKU-Mapping)
  ├── product_price_tiers
  ├── store_receipts
  └── order_items

Mapping: store_products ↔ products via curriculum_products (bestehend)
```

## Migrationsstrategie
- Feature-Flag-basierte Entitlements (has_learning_course etc.) laufen weiter
- Neue Entitlements nutzen product_id
- Frontend (useEntitlements.ts, useShop.ts) bleibt auf Feature-Flags bis Phase 2
- Ziel: Schrittweise Ablösung der Feature-Flags durch product_id-basierte Prüfung

## Nächste Phasen (nicht implementiert)
- Phase 2: Web Integration (Produktdetailseiten, Rechteprüfung im Frontend)
- Phase 3: LTI (lti_platform_registrations, lti_deployments, lti_resource_mappings, lti_launch_sessions, lti_grade_passback_queue)
- Phase 4: Mobile Commerce (store_purchase_events, store_receipt_links — Erweiterung bestehender store_receipts)
- Phase 5: SCORM Export (content_exports, content_export_artifacts)
