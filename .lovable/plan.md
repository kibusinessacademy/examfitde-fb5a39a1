## Phase B.1 — IAP E2E Smoke & Regression Gate

Repo-real plan, an bestehende SSOT (`validate-iap-receipt` → `verify-ios-receipt`/`verify-android-purchase` → `store_receipts` → `create_store_entitlement` → `entitlements` → `check_product_access_by_curriculum`) angedockt. **Keine neue Architektur, keine Shadow-Tabellen, kein Client-Unlock.**

### A) Admin-Smoke-Harness (UI)

Neu: `src/pages/admin/MobileIAPSmokePage.tsx`, eingehängt unter `/admin/tools/mobile-iap-smoke` (analog `mobile-bundle-builder`).

- Admin-Gate via vorhandenem AdminGuard im Routenbaum (kein neuer Auth-Pfad).
- Form: Plattform (ios/android) · SKU-Select (gelesen aus `platform_skus where is_active`) · Curriculum-Select · Test-Case-Dropdown (`happy | duplicate | invalid | expired`).
- Aktionen rufen ausschließlich `supabase.functions.invoke('validate-iap-receipt', …)` + `useIAPReceiptValidation` (für Cache-Invalidation).
- Anschließend Access-Check über `useProductAccessByCurriculum(curriculum_id)`-Hook und Anzeige des Player-Unlock-Status (nur Hook-Ergebnis, **kein** Direct-Read auf `entitlements`/`store_receipts`).
- UI-States: `idle | submitting | receipt_stored | entitlement_created | access_confirmed | player_unlocked | duplicate_handled | invalid_blocked | failed(reason)`.
- Server-Antwort (`receipt_id`, `entitlement_id`, `duplicate`, `expires_at`, `error`) wird ohne Raw-Receipt angezeigt.

### B) Smoke-Cases (Test-Payload-Builder)

Test-Receipts werden client-seitig im Harness gebaut (synthetisch, kein Live-Apple/Google-Call), markiert mit Präfix `SMOKE-`:

| Case | Payload-Strategie |
| --- | --- |
| iOS happy | `transaction_id = "SMOKE-IOS-<uuid>"`, `receipt_data="SMOKE_SANDBOX"` |
| Android happy | `purchase_token = "SMOKE-AND-<uuid>"`, `order_id = transaction_id` |
| Duplicate | zweiter Call mit identischem `transaction_id`/`purchase_token` → erwartet `duplicate:true` aus Verifier |
| Invalid | unbekannte SKU `SMOKE-INVALID-SKU` → Verifier wirft "Unknown SKU" |
| Expired/refunded | Heute noch kein Status-Update-Pfad im Verifier. Im UI als **TODO-Card** mit Link zu Issue `[IAP.STATUS.LIFECYCLE]` ausweisen (Blocker-Code: `not_implemented_status_lifecycle`), Smoke-Run liefert "skipped". |

Hinweis: bestehende Verifier hardcoden `environment: 'production'`. Der Harness setzt am `store_receipts.environment` nichts direkt — Markierung läuft über `SMOKE-`-Präfix im `transaction_id`. Ein nachgeschaltetes **Cleanup-RPC** (siehe Migration unten) räumt Smoke-Receipts/-Entitlements idempotent ab; Harness ruft es vor jedem Run.

### C) Backend — minimaler additiver Schreibpfad

Eine Migration:

- `public.cleanup_iap_smoke_artifacts(p_user_id uuid)` SECURITY DEFINER, admin-only via `has_role(_, 'admin')`. Löscht `entitlements` + `store_receipts` mit `transaction_id LIKE 'SMOKE-%'` für den aufrufenden Admin-User. Audit-Eintrag via `fn_emit_audit` (`action='iap_smoke_cleanup'`).
- GRANT EXECUTE auf `authenticated`. Funktion selbst prüft `has_role`.

Kein neuer Entitlement-Pfad — Cleanup ist reine Test-Hygiene und kann nichts schreiben außer löschen.

### D) Regression Tests

Neue Vitest-Suite `src/__tests__/iap/iap-ssot-contract.test.ts`:

1. Static-Scan: `validate-iap-receipt/index.ts` ruft nur `verify-ios-receipt` oder `verify-android-purchase` (regex über Source).
2. `verify-ios-receipt` ruft `create_store_entitlement` (kein direkter Insert in `entitlements`).
3. Gleiches für Android.
4. `useIAPReceiptValidation` invalidiert alle Pflicht-Cache-Keys (`product-access`, `product-access-by-curriculum`, `entitlements`, `user-entitlements-legacy`, `course-access`, `learner-course-grants`).

Neue Playwright-Spec `tests/e2e/mobile-iap-smoke.spec.ts` (nur lauffähig wenn Admin-Login verfügbar; sonst skip): durchläuft Harness happy/duplicate/invalid und assertiert die UI-States. Folgt dem `tests/e2e/_helpers.ts`-Pattern.

### E) Guard / Static Check

Neuer Lint-Sweep-Test `src/__tests__/guards/iap-shadow-paths.test.ts`:

- Verbietet außerhalb von `supabase/functions/**` und `src/admin/**`:
  - `.from('entitlements')` (read/write)
  - `.from('store_receipts')` (read/write)
  - Identifier `grantMobileAccess`, `unlockCourseLocally`, `createMobileEntitlement`, `validateReceiptClientSide`
  - localStorage-Keys: `mobile_access`, `course_unlocked`, `iap_entitlement`, `local_entitlement`
- Verbietet außerhalb `validate-iap-receipt`: zweite Dispatcher (regex auf neue Funktionen mit `verify-(ios|android)` plus Auth-Header).

### F) Observability

Harness-Ergebnistabelle pro Run: `platform · sku · curriculum_id · dispatcher_status · verifier_result · duplicate · receipt_id (hash-truncated) · entitlement_id · access_check (bool) · player_unlock (bool) · error_code`. Keine PII, kein Raw-Receipt.

### Dateien

```text
NEU  src/pages/admin/MobileIAPSmokePage.tsx
NEU  src/components/admin/iap-smoke/SmokeRunner.tsx
NEU  src/components/admin/iap-smoke/SmokeResultRow.tsx
NEU  src/lib/iap/smoke-payloads.ts
NEU  src/__tests__/iap/iap-ssot-contract.test.ts
NEU  src/__tests__/guards/iap-shadow-paths.test.ts
NEU  tests/e2e/mobile-iap-smoke.spec.ts
NEU  supabase/migrations/<ts>_iap_smoke_cleanup.sql
EDIT src/routes/AppRoutes.tsx                     (+1 lazy import, +1 Route)
EDIT src/admin/pageDescriptions.ts                (Eintrag für neue Page)
NEU  .lovable/memory/features/iap-e2e-smoke-phase-b1.md
```

### Definition-of-Done-Checkliste

1. iOS/Android/Duplicate/Invalid Smoke laufen aus dem Harness grün.
2. Expired/refunded als dokumentierter Blocker mit Trace-Code sichtbar.
3. Vitest-Contract-Suite + Guard-Suite grün.
4. Playwright-Spec passt zu vorhandener Admin-Auth-Helper (oder skip-marked, wenn keine Admin-Session).
5. Player-Unlock im Harness kommt **ausschließlich** aus `useProductAccessByCurriculum`.
6. Keine neue Tabelle, kein zweiter Entitlement-Schreibpfad, keine direkten Client-Reads auf `entitlements`/`store_receipts`.
7. Memory-File dokumentiert Plattformen/SKUs/getroffene Funktionen/offene Sandbox-Grenzen.

Bestätige den Plan, dann setze ich ihn 1:1 um.