# Memory: architektur/produkt/channel-architecture-hardening-v1
Updated: 2026-03-29

## Phase 1 Hardening Pass — Ergebnisse

### 1. RLS gehärtet

**products:**
- Authenticated: Lesen von `visibility='public'` ODER `status='active'` ODER wenn Entitlement existiert
- Anon: Nur `visibility='public' AND status='active'`
- Writes: Nur service_role (bestehende Policy)

**entitlements:**
- Bestehend (unverändert): Eigene (user_id=auth.uid()), Admin-Bypass, INSERT/UPDATE/DELETE denied
- NEU: Lesen über learner_identity_id → user_id Auflösung

### 2. can_access_product() gehärtet

- `SET search_path = public` ✅
- SECURITY DEFINER ✅
- EXECUTE revoked von PUBLIC, nur authenticated + service_role
- **Zwei Zugriffspfade:**
  - Path A: Direktes Entitlement (user_id oder learner_identity)
  - Path B: Org-Lizenz (org_license_assignments → org_licenses → product_id)
- Beide Pfade prüfen Zeitfenster (valid_from/valid_until bzw. starts_at/ends_at)

### 3. Audit-View: v_entitlement_migration_audit

Nur für service_role zugänglich. Prüft:
- total_entitlements / with_product_id / without_product_id
- legacy_active_no_product (Feature-Flags ohne product_id)
- orphaned_entitlements (product_id zeigt auf nicht-existierendes Produkt)
- duplicate_current_count (mehrere is_current=true pro Produkt)
- orphaned_assignments (aktive Assignments ohne aktive Lizenz)

**Ergebnis 2026-03-29:** 5 total, 0 mit product_id, 5 Legacy ohne Mapping, 0 Orphans.

### 4. Guard: Single Current Version

Trigger `trg_guard_single_current_version` auf product_versions:
- Bei INSERT/UPDATE mit is_current=true werden alle anderen Versionen desselben Produkts auf is_current=false gesetzt
- Verhindert inkonsistente "aktuelle" Versionen

### 5. Legacy-Deprecation

Feature-Flag-Spalten in entitlements sind via SQL COMMENT als DEPRECATED markiert:
- has_learning_course
- has_exam_trainer
- has_ai_tutor
- has_oral_trainer
- has_handbook

Entfernung geplant für Phase 3 (nach vollständigem Cutover).

## Read-Path Cutover-Plan

### Phase 1 (jetzt): Koexistenz
- Frontend: `useEntitlements.ts` liest weiterhin Feature-Flags über `get_user_entitlements_v2` RPC
- Backend: `can_access_product()` steht bereit, wird noch nicht von Frontend genutzt
- Kein Breaking Change für bestehende Nutzer

### Phase 2 (Web Integration): Dual-Read
- Neuer Hook `useProductAccess(productId)` ruft `can_access_product()` auf
- Alte Hooks bleiben als Fallback
- Produktdetailseiten nutzen neues System
- Feature-spezifische Checks (exam_trainer, ai_tutor) brauchen zusätzliche Logik:
  → product_artifact_mappings definieren, welche Features ein Produkt enthält

### Phase 3 (Cutover): Migration
- Alle 5 Legacy-Entitlements erhalten product_id-Mapping
- Frontend wird auf `useProductAccess()` umgestellt
- Alte Feature-Flag-RPCs werden deprecated
- Feature-Flag-Spalten werden entfernt

### Offene Fragen für Phase 2
1. Wie wird die Feature-Granularität (exam_trainer vs. oral_trainer) im neuen product_id-System abgebildet?
   → Über product_artifact_mappings.artifact_type oder über product_type
2. Backfill der 5 bestehenden Entitlements: Braucht curriculum_id → products.id Mapping
3. store_products ↔ products Brücke: curriculum_products-Tabelle erweitern oder ersetzen?
