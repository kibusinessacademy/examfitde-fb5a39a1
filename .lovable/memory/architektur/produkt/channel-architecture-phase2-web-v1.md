# Memory: architektur/produkt/channel-architecture-phase2-web-v1
Updated: 2026-03-29

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
| HandbookPage.tsx | ⏳ useUserEntitlements (useShop.ts) | Noch nicht umgestellt |
| HandbookChapterPage.tsx | ⏳ useUserEntitlements (useShop.ts) | Noch nicht umgestellt |

### Verbleibende Legacy-Pfade

1. **useUserEntitlements in useShop.ts** — Genutzt von Handbook-Pages. Ruft altes `get_user_entitlements` RPC auf. Umstellung erst nach product_id-Backfill.
2. **useEntitlements.ts** — Datei existiert noch, wird aber nicht mehr importiert. Kann in Phase 3 entfernt werden.
3. **useShop.ts: useUserEntitlements()** — Shop-spezifischer Entitlement-Check. Bleibt bis Commerce-Layer auf product_id umgestellt ist.

### Kompatibilitätsnotiz

Die Bridge-Funktion `check_product_access_by_curriculum` stellt sicher, dass:
- Bestehende Legacy-Entitlements (Feature-Flags) weiterhin funktionieren
- Neue product_id-basierte Entitlements sofort wirken sobald products.curriculum_id gesetzt wird
- Kein Breaking Change für Endnutzer entsteht
- Der Cutover schrittweise pro Feature/Page möglich ist

### Nächste Schritte für Phase 3

1. products.curriculum_id für bestehende Produkte befüllen
2. product_id in bestehende 5 Entitlements backfillen
3. Handbook-Pages auf useProductAccessByCurriculum umstellen
4. useEntitlements.ts entfernen
5. Legacy-Feature-Flags aus Entitlements entfernen
