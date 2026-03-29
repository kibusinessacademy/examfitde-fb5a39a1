# Memory: architektur/produkt/channel-architecture-phase3-legacy-removal-v1
Updated: 2026-03-29

## Phase 3: Legacy Removal — Abgeschlossen

### Phase 3A: Deaktivierung

**Frontend-Cutover:**
- HandbookPage.tsx → useProductAccessByCurriculum (statt useUserEntitlements)
- HandbookChapterPage.tsx → useProductAccessByCurriculum (statt useUserEntitlements)
- Alle aktiven Pages nutzen jetzt ausschließlich product-basierte Hooks

**Edge Functions:**
- get-exam-questions → check_product_access_by_curriculum (statt check_user_entitlement)
- get-exam-session-questions → check_product_access_by_curriculum (statt check_user_entitlement)
- get-exam-results → check_product_access_by_curriculum (statt check_user_entitlement) ✅ P0-Fix
- run-tests → Smoke/Sanity-Tests auf check_product_access_by_curriculum umgestellt ✅ P0-Fix

**Bridge RPC gehärtet:**
- check_product_access_by_curriculum: Path 2 (Legacy Feature-Check) ENTFERNT
- check_product_access_by_curriculum: Path 3 (Any-Entitlement Fallback) ENTFERNT
- Nur noch Path 1: products.curriculum_id → can_access_product()

### Phase 3B: Schema-Bereinigung

**Entitlements-Spalten gedroppt:**
- has_learning_course ❌
- has_exam_trainer ❌
- has_ai_tutor ❌
- has_oral_trainer ❌
- has_handbook ❌

**RPCs gedroppt:**
- check_user_entitlement(uuid, uuid, text) ❌
- get_user_entitlements(uuid, uuid) ❌
- get_user_entitlements_v2(uuid, uuid) ❌

**Deprecated Hooks (noch vorhanden, aber inaktiv):**
- useEntitlements.ts: alle 3 Exports sind deprecated-Stubs
- useShop.ts: useUserEntitlements ist deprecated-Stub

### Verbleibende Legacy-Nutzung (bewusst behalten)

| Kontext | Was | Warum behalten |
|---|---|---|
| course_packages.feature_flags | JSONB mit has_learning_course etc. | Build-Pipeline-Flags, nicht Entitlement-Flags |
| FeatureFlagEditor.tsx | Admin-UI für Build-Flags | Steuert Content-Erstellung, nicht Zugriff |
| pipeline-ui-registry.ts | Step-UI-Mapping | Pipeline-Visualisierung |
| build-course-package/index.ts | Build-Optionen | Content-Generierung |
| admin-ops/index.ts | Track-Switch-Logik | Admin-Operation |
| Test-Dateien | wave2-entitlement-matrix.test.ts | Muss auf neue RPCs aktualisiert werden |

### Audit-Status Post-Phase-3

- v_entitlement_migration_audit: bereinigt, referenziert keine Legacy-Spalten mehr
- Alle Entitlements haben product_id (100%)
- 0 Orphans, 0 Duplikate

### Zugriffsarchitektur (Final)

```
Web/App Request
  → useProductAccessByCurriculum(curriculumId, feature?)
    → check_product_access_by_curriculum RPC
      → products WHERE curriculum_id = X
        → can_access_product(user_id, product_id)
          → Path A: Direct entitlement (user_id / learner_identity_id)
          → Path B: Org license assignment
```

Kein Legacy-Fallback mehr im aktiven Pfad.
