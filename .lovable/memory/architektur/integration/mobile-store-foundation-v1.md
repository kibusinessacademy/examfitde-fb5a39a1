# Memory: architektur/integration/mobile-store-foundation-v1
Updated: 2026-03-29

## Mobile Store Integration — P0 Security Pass Complete

### Datenmodell

| Tabelle | Zweck | FK-Beziehungen |
|---|---|---|
| `mobile_store_products` | Apple/Google SKU → Examfit-Produkt Mapping | → products |
| `mobile_store_purchase_events` | Kauf-Events mit vollem Lifecycle | → auth.users, → learner_identities |
| `mobile_store_receipt_links` | Verknüpfung Kauf → Entitlement mit Subscription-Tracking | → mobile_store_purchase_events, → entitlements |
| `mobile_store_sync_log` | Ops-Log für Store-Synchronisation | – |

**Hinweis**: `mobile_store_*` Prefix wegen bestehender Legacy-Tabelle `store_products` (Stripe-basiert).

### Verification Status Model (gehärtet)

```
pending → structurally_valid → provider_verified → [refunded | expired]
                             → rejected
                             → error (retry via reconcile)
```

**Kritische Regel**: Entitlement-Erzeugung NUR aus `provider_verified` oder `verified` Status.
`structurally_valid` erzeugt KEIN Entitlement — erfordert echte Provider-Verifikation.

### Provider-Verifikation (P0 Complete)

#### Apple
- **Kryptografische JWS-Signaturprüfung** gegen Apple JWKS (`https://appleid.apple.com/auth/keys`)
- JWKS-Cache mit 1h TTL
- kid-Matching → RS256/ES256 Signaturverifikation via Web Crypto API
- Bundle-ID-Validierung (`APPLE_ALLOWED_BUNDLE_IDS`)
- Environment-Check (`APPLE_ENVIRONMENT`)
- Revocation-Detection
- **HARD FAIL**: Ohne erfolgreiche kryptografische Prüfung → kein `provider_verified`
- Legacy-Receipts (nicht-JWS) werden abgelehnt

#### Google
- **Google Play Developer API Integration** (vollständig implementiert)
- Service Account OAuth2 JWT-basierte Authentifizierung
- `purchases.products.get` für Einmalkäufe
- `purchases.subscriptionsv2.tokens` für Subscriptions
- purchaseState / acknowledgementState / subscriptionState Prüfung
- Package-Name-Validierung (`GOOGLE_ALLOWED_PACKAGE_NAMES`)
- **HARD FAIL**: API-Fehler oder fehlende Konfiguration → kein Entitlement
- Ohne `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` → nur `structurally_valid`

### Subscription Lifecycle
- `subscription_period_start` / `subscription_period_end` auf Purchase Events + Receipt Links
- `auto_renew_status` tracking
- `renewal_count` / `last_renewal_at` auf Receipt Links
- `create_mobile_store_entitlement()` mit Security Gate: prüft `verification_status`
- Bei Renewal: Entitlement `valid_until` wird aktualisiert statt neues erstellt
- `expire_mobile_store_subscriptions()` RPC für automatische Ablaufbehandlung

### Identity Linking Policy
- `purchase_context`: 'authenticated' | 'anonymous' | 'restore' | 'transfer'
- `link_status`: 'linked' | 'unlinked' | 'pending_link' | 'conflict'
- `link_mobile_store_purchase_to_user()` RPC
- Kauf ohne Login erlaubt (anonymous) → spätere Zuordnung über link-Funktion

### Reconcile-Logik (gehärtet)
- `reconcile-store-purchases` promoted pending/error → `structurally_valid` (NICHT zu `provider_verified`)
- Echte Provider-Verifikation nur über `verify-apple-purchase` / `verify-google-purchase`
- Orphan-Fix: nur für bereits `provider_verified` Events ohne Entitlement
- `structurally_valid` Events werden gezählt aber NICHT auto-promoted

### Enhanced Audit View
`v_mobile_store_purchase_audit` mit Anomalie-Markern:
- `verified_without_receipt_link`
- `verified_without_entitlement`
- `active_but_expired`
- `refunded_but_active`
- `unlinked_purchase`
- `awaiting_provider_verification`

### Sicherheit
- RLS auf allen Tabellen
- `service_role` Vollzugriff
- `authenticated` nur eigene Purchase Events + aktive Store-Produkte
- RPCs: SECURITY DEFINER + REVOKE FROM PUBLIC
- `create_mobile_store_entitlement()` hat Security Gate: prüft verification_status
- Bundle-ID / Package-Name-Validierung in Edge Functions
- Environment-Validierung (production vs sandbox)

### Edge Functions

| Function | Zweck | Status |
|---|---|---|
| `verify-apple-purchase` | Apple IAP mit kryptografischer JWS-Verifikation gegen JWKS | ✅ P0 Complete |
| `verify-google-purchase` | Google Play mit Developer API Integration | ✅ P0 Complete |
| `reconcile-store-purchases` | Retry + Expiry + Orphan Fix (NICHT auto-verify) | ✅ P0 Complete |

### Benötigte Secrets für Go-Live

| Secret | Zweck | Status |
|---|---|---|
| `APPLE_ALLOWED_BUNDLE_IDS` | Bundle-ID Whitelist | Konfigurierbar |
| `APPLE_ENVIRONMENT` | production/sandbox | Konfigurierbar |
| `GOOGLE_ALLOWED_PACKAGE_NAMES` | Package-Name Whitelist | Konfigurierbar |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google Play Developer API Auth | **Erforderlich für Google Go-Live** |

### P0 Security Status: COMPLETE (beide Stores)

Beide Stores (Apple + Google) haben jetzt:
- Echte Provider-Verifikation (Apple: JWKS/JWS, Google: Play Developer API)
- Hard Gate: Entitlement NUR bei `provider_verified`
- Package/Bundle-Validierung
- State/Revocation-Prüfung
- API-Fehler → Hard Fail (kein Entitlement)
- Ohne Provider-Credentials → nur `structurally_valid` (kein Entitlement)

### Verbleibende TODO für volle Produktionsreife

1. **Secrets konfigurieren**: `APPLE_ALLOWED_BUNDLE_IDS`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`
2. **Webhook-Endpoints**: Apple Server Notifications v2, Google RTDN
3. **Grace Period**: Billing Retry Handling für Subscriptions
4. **Restore Purchases**: Client-seitiger Restore-Flow mit `purchase_context = 'restore'`
5. **Purchase Acknowledgement**: Google Play acknowledge nach erfolgreicher Verifikation
6. **Sandbox-Tests**: Echte Apple/Google Test-Transaktionen verifizieren
