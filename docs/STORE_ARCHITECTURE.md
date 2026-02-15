# Store-Ready Architektur – Apple App Store & Google Play

## Übersicht

ExamFit unterstützt drei Kaufkanäle mit einheitlichem Entitlement-System:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Web/PWA   │    │  iOS (IAP)  │    │ Android     │
│   Stripe    │    │  StoreKit   │    │ Play Billing│
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────┐
│              Entitlement Service (SSOT)              │
│         entitlements + store_receipts tables          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              Content Delivery Layer                  │
│    Online-Zugang   |   Offline-Lernpakete (ZIP)     │
└─────────────────────────────────────────────────────┘
```

---

## 1. Store-Anforderungen

### Apple App Store (iOS)
- **Digitale Inhalte in App → In-App Purchase (IAP) Pflicht**
- Externe Kauf-Links nur mit StoreKit External Purchase Link Entitlement (EU/regional)
- Account Deletion muss implementiert sein
- Privacy Nutrition Labels (App Store Connect)

### Google Play (Android)
- **Digitale Güter → Play Billing Library v7+ Pflicht**
- Alternative Billing nur über regionale Programme
- Data Safety Section erforderlich
- Keine Mischung von Play Billing + External Offers (wo verboten)

---

## 2. Datenmodell

### platform_skus
Mapping zwischen internen Produkten und Store-spezifischen SKUs:

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| product_id | UUID FK → store_products | Internes Produkt |
| platform | 'ios' / 'android' / 'web' | Plattform |
| sku | TEXT | Store-SKU (z.B. `com.examfit.bundle.12m`) |
| store_product_id | TEXT | Apple/Google Product ID |
| is_consumable | BOOLEAN | Non-consumable für Lizenzen |

### store_receipts
Audit-Log aller Store-Käufe:

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| user_id | UUID | Käufer |
| platform | 'ios' / 'android' | Quelle |
| transaction_id | TEXT | Store-Transaction-ID (unique) |
| validation_status | TEXT | pending/valid/invalid/fraud/refunded |
| entitlement_id | UUID FK | Verknüpftes Entitlement |

### entitlements (erweitert)
Neue Spalten:

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| source | TEXT | 'web' / 'ios' / 'android' / 'promo' / 'enterprise' |
| store_receipt_id | UUID FK | Verknüpfung zum Store-Receipt |
| auto_renew | BOOLEAN | Auto-Renewal aktiv? |

### content_packages
Offline-Lernpakete:

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| curriculum_id | UUID | Curriculum |
| version | INTEGER | Paket-Version |
| format | 'zip' / 'delta' | Vollpaket oder Delta |
| manifest | JSONB | Assets, Checksums, Größe |
| signature | TEXT | Ed25519/JWT Signatur |
| storage_path | TEXT | Pfad im Storage-Bucket |

### store_policy_flags
Feature Flags für regionale Store-Policies:

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| flag_key | TEXT | z.B. 'ios_external_purchase_link_eu' |
| platform | TEXT | ios/android/all |
| regions | TEXT[] | z.B. {'DE', 'AT', 'EU'} |
| is_enabled | BOOLEAN | Aktiv? |

---

## 3. Kauffluss

### iOS (StoreKit 2)
```
App → StoreKit.purchase(sku) → Transaction
  → POST /verify-ios-receipt { transaction_id, sku, curriculum_id }
    → Deduplizierung (transaction_id unique)
    → SKU → product_id auflösen
    → Apple Server API v2 Validation (async)
    → store_receipt INSERT
    → create_store_entitlement() → entitlement INSERT
  ← { success, entitlement_id, expires_at }
```

### Android (Play Billing v7)
```
App → BillingClient.launchBillingFlow(sku) → Purchase
  → POST /verify-android-purchase { purchase_token, sku, curriculum_id }
    → Deduplizierung (order_id unique)
    → SKU → product_id auflösen
    → Google Play Developer API Validation (async)
    → store_receipt INSERT
    → create_store_entitlement() → entitlement INSERT
  ← { success, entitlement_id, expires_at }
```

### Web (Stripe – bestehend)
```
Shop → POST /create-checkout → Stripe Session
  → Stripe Webhook → license_package + seats + entitlements
```

---

## 4. Lernpakete (Content Packages)

### Format: Signiertes ZIP-Bundle
```
package-v3.zip
├── manifest.json      # Version, Kurs, Checksums, Assets-Liste
├── h5p/               # H5P-Inhalte
├── images/            # Hero + Thumbnails
├── data/              # Strukturierte Kursdaten (JSON)
└── signature.jwt      # Server-Signatur (Ed25519)
```

### Schutz
- Pakete werden nur ausgeliefert wenn Entitlement aktiv
- Download über signed URLs (120s Ablauf)
- App prüft JWT-Signatur vor Nutzung
- Checksums für Integritätsprüfung

### Build-Prozess
```
build-content-package(curriculum_id)
  → Exportiert H5P + Assets aus Storage
  → Generiert manifest.json mit Checksums
  → Erstellt ZIP-Bundle
  → Signiert mit Ed25519-Key
  → Upload in content-packages Bucket
  → content_packages Row INSERT
```

---

## 5. Regionale Policy-Steuerung

| Flag | Platform | Regionen | Wirkung |
|------|----------|----------|---------|
| ios_external_purchase_link_eu | ios | EU | Externe Kauf-Links in iOS erlaubt |
| android_alternative_billing_eea | android | EEA | Alternative Zahlungswege erlaubt |
| web_checkout_fallback | all | * | Web-Checkout als Fallback anzeigen |

App prüft zur Laufzeit:
```typescript
const flags = await supabase
  .from('store_policy_flags')
  .select('*')
  .eq('is_enabled', true);

const canShowWebCheckout = flags.some(f =>
  f.flag_key === 'ios_external_purchase_link_eu' &&
  f.regions.includes(userRegion)
);
```

---

## 6. Benötigte Secrets (Phase 2+)

| Secret | Zweck |
|--------|-------|
| APPLE_SHARED_SECRET | App Store Server API Validation |
| APPLE_ISSUER_ID | App Store Connect API |
| APPLE_KEY_ID | App Store Connect API Key |
| APPLE_PRIVATE_KEY | App Store Connect API (p8) |
| GOOGLE_PLAY_SERVICE_ACCOUNT_JSON | Play Developer API Auth |

---

## 7. Umsetzungsphasen

### Phase 1 ✅ (aktuell)
- [x] DB-Schema: platform_skus, store_receipts, content_packages
- [x] Entitlements erweitert (source, store_receipt_id, auto_renew)
- [x] Edge Functions: verify-ios-receipt, verify-android-purchase
- [x] store_policy_flags für regionale Steuerung

### Phase 2 (nächster Schritt)
- [ ] Apple App Store Server API v2 Integration
- [ ] Google Play Developer API Integration
- [ ] StoreKit 2 Client-Code (Capacitor Plugin)
- [ ] Play Billing v7 Client-Code (Capacitor Plugin)
- [ ] Secrets konfigurieren

### Phase 3 (Content Packages)
- [ ] build-content-package Edge Function
- [ ] Storage-Bucket: content-packages
- [ ] App Download Manager + Offline Cache
- [ ] Ed25519 Signatur-Prüfung im Client

### Phase 4 (Store Submission)
- [ ] Privacy Nutrition Labels (Apple)
- [ ] Data Safety Section (Google)
- [ ] Account Deletion Flow
- [ ] Store Screenshots & Metadata
- [ ] Review-Flows testen
