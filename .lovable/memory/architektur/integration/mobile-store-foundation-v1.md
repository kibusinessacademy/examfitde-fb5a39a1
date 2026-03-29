# Memory: architektur/integration/mobile-store-foundation-v1
Updated: 2026-03-29

## Mobile Store Integration — P0 Hardening Complete

### Datenmodell

| Tabelle | Zweck | FK-Beziehungen |
|---|---|---|
| `mobile_store_products` | Apple/Google SKU → Examfit-Produkt Mapping | → products |
| `mobile_store_purchase_events` | Kauf-Events mit vollem Lifecycle | → auth.users, → learner_identities |
| `mobile_store_receipt_links` | Verknüpfung Kauf → Entitlement mit Subscription-Tracking | → mobile_store_purchase_events, → entitlements |
| `mobile_store_sync_log` | Ops-Log für Store-Synchronisation | – |

**Hinweis**: `mobile_store_*` Prefix wegen bestehender Legacy-Tabelle `store_products` (Stripe-basiert).

### P0 Hardening (v2)

#### Provider-Verifikation
- **Apple**: JWS-Payload-Dekodierung, Bundle-ID-Validierung (`APPLE_ALLOWED_BUNDLE_IDS`), Environment-Check (`APPLE_ENVIRONMENT`), Revocation-Detection. Full JWS-Signaturprüfung vorbereitet (guarded auf `APPLE_SHARED_SECRET`).
- **Google**: purchaseState/acknowledgementState-Prüfung, Package-Name-Validierung (`GOOGLE_ALLOWED_PACKAGE_NAMES`), Cancellation-Check, Expiry-Check. Full Play Developer API vorbereitet (guarded auf `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`).

#### Subscription Lifecycle
- `subscription_period_start` / `subscription_period_end` auf Purchase Events + Receipt Links
- `auto_renew_status` tracking
- `renewal_count` / `last_renewal_at` auf Receipt Links
- `create_mobile_store_entitlement()` erweitert um `p_subscription_period_start` / `p_subscription_period_end`
- Bei Renewal: Entitlement `valid_until` wird aktualisiert statt neues erstellt
- `expire_mobile_store_subscriptions()` RPC für automatische Ablaufbehandlung
- Job: `expire_store_subscriptions` registriert

#### Identity Linking Policy
- `purchase_context`: 'authenticated' | 'anonymous' | 'restore' | 'transfer'
- `link_status`: 'linked' | 'unlinked' | 'pending_link' | 'conflict'
- `link_mobile_store_purchase_to_user()` RPC: verknüpft anonyme Käufe sicher mit User + Entitlement
- Kauf ohne Login erlaubt (anonymous) → spätere Zuordnung über link-Funktion

#### Enhanced Audit View
`v_mobile_store_purchase_audit` mit Anomalie-Markern:
- `verified_without_receipt_link`
- `verified_without_entitlement`
- `active_but_expired`
- `refunded_but_active`
- `unlinked_purchase`

#### Verification Status erweitert
`pending` → `provider_verified` → `verified` → `refunded` | `expired` | `rejected` | `error`

### Sicherheit
- RLS auf allen Tabellen
- `service_role` Vollzugriff
- `authenticated` nur eigene Purchase Events + aktive Store-Produkte
- RPCs: SECURITY DEFINER + REVOKE FROM PUBLIC
- Bundle-ID / Package-Name-Validierung in Edge Functions
- Environment-Validierung (production vs sandbox)

### Edge Functions

| Function | Zweck | Status |
|---|---|---|
| `verify-apple-purchase` | Apple IAP mit JWS/Bundle/Environment Checks | ✅ P0 Hardened |
| `verify-google-purchase` | Google Play mit State/Package/Expiry Checks | ✅ P0 Hardened |
| `reconcile-store-purchases` | Retry + Subscription Expiry + Orphan Fix | ✅ P0 Hardened |

### TODO für volle Produktionsreife

1. **Apple**: Full JWS Signaturverifikation gegen Apple JWKS (benötigt `APPLE_SHARED_SECRET`)
2. **Google**: Play Developer API Integration (benötigt `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`)
3. **Webhook-Endpoints**: Apple Server Notifications v2, Google RTDN
4. **Grace Period**: Billing Retry Handling für Subscriptions
5. **Restore Purchases**: Client-seitiger Restore-Flow mit `purchase_context = 'restore'`
