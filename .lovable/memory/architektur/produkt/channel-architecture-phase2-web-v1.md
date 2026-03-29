# Memory: architektur/produkt/channel-architecture-phase2-web-v1
Updated: 2026-03-29 (Data Completion Pass)

## Phase 2: Web Integration — Umgesetzt

### Neue RPCs (SECURITY DEFINER, search_path=public)

**check_product_access_by_curriculum(p_user_id, p_curriculum_id, p_feature)**
- Bridge-Funktion für Übergangsphase
- Path 1: Neues Produktsystem (products.curriculum_id → can_access_product)
- Path 2: Legacy Feature-Flags (check_user_entitlement)
- Path 3: Any-entitlement Fallback für curriculum_id
- EXECUTE: nur authenticated + service_role

**get_product_catalog(p_channel)**
- Lädt aktive Produkte mit channel_config
- Filtert auf status='active', visibility IN ('public','enterprise_only')
- EXECUTE: authenticated + anon + service_role

**get_product_detail(p_slug)**
- Einzelprodukt mit aktueller product_version (is_current=true)
- EXECUTE: authenticated + anon + service_role

### Neue Frontend-Hooks (src/hooks/useProductAccess.ts)

**useProductAccess(productId)** — Direkter product_id-basierter Zugriff via can_access_product()

**useProductAccessByCurriculum(curriculumId, feature?)** — Bridge-Hook, ersetzt useCheckEntitlement. Nutzt check_product_access_by_curriculum RPC.

**useProductCatalog(channel)** — Produktkatalog laden

**useProductDetail(slug)** — Einzelprodukt mit Version

### Cutover-Status

| Page | Alt (useCheckEntitlement) | Neu (useProductAccessByCurriculum) |
|---|---|---|
| ExamTrainer.tsx | ❌ entfernt | ✅ umgestellt |
| OralExamTrainer.tsx | ❌ entfernt | ✅ umgestellt |
| CourseDetailPage.tsx | ❌ entfernt | ✅ umgestellt |
| LearnerDashboard.tsx | ❌ entfernt | ✅ umgestellt |
| HandbookPage.tsx | ❌ useShop entfernt | ✅ useEntitlements (canonical) |
| HandbookChapterPage.tsx | ❌ useShop entfernt | ✅ useEntitlements (canonical) |

### Data Completion Pass (2026-03-29)

**Audit-Ergebnis nach Backfill:**
- total_entitlements: 5
- with_product_id: **5** (100%)
- without_product_id: **0**
- legacy_active_no_product: **0**
- orphaned_entitlements: 0
- duplicate_current_count: 0
- orphaned_assignments: 0

**Produkte backfilled:**
- 2 bestehende Produkte: curriculum_id + title gesetzt, status → active
- 3 neue Produkte erstellt (IT-System-Management, Büromanagement, E-Commerce)
- Alle 5 via curriculum_id → products.id verknüpft

**Bridge-Fallback gehärtet:**
- Path 3 (Any-entitlement) ist jetzt strikt auf das spezifische Curriculum begrenzt
- Erfordert mindestens ein aktives Feature-Flag auf genau diesem Curriculum
- Kein cross-curriculum Zugriff möglich

### Verbleibende Legacy-Pfade

1. **useEntitlements.ts** — Wird noch von Handbook-Pages importiert für Feature-Flag-Check (has_learning_course). Kann entfernt werden wenn Handbook-Access über product_type oder artifact_mapping geprüft wird.
2. **useShop.ts: useUserEntitlements()** — Nicht mehr von Pages importiert. Nur noch intern in Shop-Kontext. Kann in Phase 3 entfernt werden.

### Nächste Schritte für Phase 3 (Legacy Removal)

1. useEntitlements.ts komplett entfernen (Handbook-Check auf product-basiert umstellen)
2. useShop.ts: useUserEntitlements() entfernen
3. Legacy-Feature-Flag-Spalten aus entitlements entfernen
4. check_user_entitlement RPC deprecated markieren
5. get_user_entitlements / get_user_entitlements_v2 RPCs deprecated markieren
