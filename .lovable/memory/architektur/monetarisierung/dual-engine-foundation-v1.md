# Memory: architektur/monetarisierung/dual-engine-foundation-v1
Updated: 2026-03-29 (Hardening Pass)

## Dual-Engine Monetarisierung — B2C + B2B auf gemeinsamer SSOT

### Geschäftsmodell
- **Einmalzahlung** (kein Abo): z.B. 39€ für 12 Monate Zugang
- **Kein Subscription-Modell**: Entitlements haben `valid_from` + `valid_until`
- **Multi-Channel**: Stripe (Web) + Apple IAP + Google Play

### Access-Logik (SSOT Master Rule)

```
IF can_access_product(user, product) → allow (personal entitlement)
ELSE IF check_org_license_access(user, product) → allow (B2B license)
ELSE → paywall (resolve variant)
```

### B2C: Revenue Scaling Engine

#### Paywall Experiments
- `paywall_experiments`: A/B-Test-Definitionen mit Status-Lifecycle
- `paywall_variants`: Preis, Layout, Trigger, Urgency, Platform-SKUs
- `experiment_assignments`: Sticky User→Variant Zuordnung mit Conversion-Tracking

#### Variant-Auflösung
- `assign_paywall_variant()` RPC: Weighted random, sticky assignment, **race-safe** (re-reads after ON CONFLICT)
- `resolve-paywall` Edge Function: Prüft Access → Org → Variant → Checkout-ID + `actual_price_cents`
- Platform-spezifisch: `stripe_price_id` (Web), `apple_sku` (iOS), `google_sku` (Android)
- **Channel Pricing**: `web_price_cents`, `ios_price_cents`, `android_price_cents` (fallback auf `price_cents`)

#### Conversion Tracking
- `record_experiment_conversion()` RPC: Nach erfolgreichem Kauf
- `v_experiment_results` View: CR%, Revenue, per Variant

#### Trigger-Kontexte
- `after_readiness_check` (rot = Verkaufshebel)
- `after_fail`, `after_simulation`, `after_quiz`
- `direct`, `time_based`

### B2B: Enterprise Engine

#### Datenmodell
- `organizations`: Firmen, Schulen, IHKs, Bildungsträger
- `org_memberships`: User↔Org mit Rollen (owner, admin, manager, learner)
- `org_licenses`: Product↔Org mit Seat-Kontingent + Zeitraum
  - **Partial Unique Index**: Nur eine aktive Lizenz pro Org+Product (`WHERE status = 'active'`)
- `org_license_seats`: Explizite User↔License Seat-Zuordnung (claimed_at/released_at)
  - Trigger `trg_sync_seats_used` hält `seats_used` automatisch synchron

#### Access-Check (gehärtet)
- `check_org_license_access()`: Prüft ob User einen **tatsächlichen Seat** hat (nicht nur freie Plätze)
  - JOIN über `org_license_seats` → `org_licenses`
  - Validiert: seat claimed, license active, not expired

#### Admin Views
- `v_org_license_overview`: Seats, Nutzung, Laufzeiten pro Org
- `v_experiment_results`: A/B-Test-Performance für Admin-Dashboard

### Frontend Hooks

| Hook | Zweck |
|---|---|
| `usePaywallVariant` | Resolves sticky A/B variant for experiment |
| `useRecordConversion` | Records purchase as experiment conversion |
| `useOrgLicenseAccess` | Checks B2B license access for product |
| `useUserOrganizations` | Lists user's org memberships |
| `getCheckoutId` | Returns platform-specific checkout ID |

### Edge Functions

| Function | Zweck |
|---|---|
| `resolve-paywall` | Unified access check + variant resolution + checkout ID |

### Sicherheit
- Alle RPCs: SECURITY DEFINER + REVOKE FROM PUBLIC
- RLS auf allen neuen Tabellen
- Experiment Results nur für service_role
- Org-Admins können nur eigene Org verwalten
- Paywall-Varianten read-only für authenticated (aktive Experiments)

### Verkaufshebel
- Prüfungsreife-Score als primärer Conversion-Trigger
- "Du bist bei 42% — unter 60% fallen 73% durch"
- B2B Cross-Sell: Azubi teilt Status → Betrieb kauft Lizenzen
