# Memory: architektur/integration/mobile-store-foundation-v1
Updated: 2026-03-29

## Mobile Store Integration Foundation — Architektur-Überblick

### Datenmodell

| Tabelle | Zweck | FK-Beziehungen |
|---|---|---|
| `mobile_store_products` | Apple/Google SKU → Examfit-Produkt Mapping | → products |
| `mobile_store_purchase_events` | Kauf-Events mit Validierungsstatus | → auth.users, → learner_identities |
| `mobile_store_receipt_links` | Verknüpfung Kauf → Entitlement | → mobile_store_purchase_events, → entitlements |
| `mobile_store_sync_log` | Ops-Log für Store-Synchronisation | – |

**Hinweis**: `mobile_store_*` Prefix wegen bestehender Legacy-Tabelle `store_products` (Stripe-basiert).

### Sicherheit

- RLS auf allen Tabellen
- `service_role` Vollzugriff
- `authenticated` kann nur eigene Purchase Events lesen + aktive Store-Produkte
- Keine `anon`-Zugriffsrechte
- RPCs: SECURITY DEFINER + REVOKE FROM PUBLIC
- Audit-View `v_mobile_store_purchase_audit` nur service_role

### RPCs

| Funktion | Zweck | Zugriff |
|---|---|---|
| `resolve_mobile_store_product` | Store + SKU → Produkt auflösen | service_role |
| `ensure_mobile_learner_identity` | Mobile-Learner-Identity finden/erstellen | service_role |
| `create_mobile_store_entitlement` | Idempotent Entitlement aus Kauf erstellen | service_role |
| `revoke_mobile_store_entitlement` | Entitlement bei Refund/Revoke deaktivieren | service_role |

### Edge Functions

| Function | Zweck | Status |
|---|---|---|
| `verify-apple-purchase` | Apple IAP serverseitige Validierung + Entitlement | ✅ Foundation |
| `verify-google-purchase` | Google Play serverseitige Validierung + Entitlement | ✅ Foundation |
| `reconcile-store-purchases` | Nachverarbeitung pending/error Events | ✅ Foundation |

### Entitlement-Mapping

- `source_type = 'apple_iap'` für Apple-Käufe
- `source_type = 'google_play'` für Google-Käufe
- Non-consumable: `valid_until = 2099-12-31`
- Subscription: `valid_until = now() + 30 days` (muss bei Renewal aktualisiert werden)
- Idempotent: gleiche Transaktion erzeugt kein doppeltes Entitlement
- Revoke: `revoke_mobile_store_entitlement()` setzt `valid_until = now()`

### Produktintegration

- Store-Produkte referenzieren `products.id` direkt
- Kein Legacy-Feature-Flag-Pfad
- Zugriff nach Kauf über `can_access_product()` — identisch zu Web/LTI

### TODO für Produktionsreife

1. **Apple**: App Store Server API v2 Integration (JWS Verification)
2. **Google**: Play Developer API Integration (purchase token verification)
3. **Webhook-Endpoints**: Apple Server Notifications v2, Google RTDN
4. **Subscription Lifecycle**: Renewal, Grace Period, Expiry, Billing Retry
5. **Refund Handling**: Automatische Entitlement-Revocation bei Store-Refund
6. **Bundle Resolution**: Serverseitige Auflösung von Bundle → Einzel-Entitlements
