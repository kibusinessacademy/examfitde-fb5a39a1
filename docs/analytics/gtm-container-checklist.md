# GTM Container Setup Checklist — `GTM-K39CL625`

SSOT: [`funnel-events.schema.json`](./funnel-events.schema.json).
Architektur: GTM ist **Fan-out-Schicht** — jeder Tag wird durch einen **Custom Event Trigger** ausgelöst, der exakt auf den `event`-Wert aus dem DataLayer matcht.

---

## A. DataLayer-Variablen anlegen (einmalig)

Type = **Data Layer Variable**, Version = **2**:

| Variable Name (in GTM)   | Data Layer Variable Name | Verwendung                         |
|--------------------------|--------------------------|------------------------------------|
| `dlv.event`              | `event`                  | (auto via Built-In `Event`)        |
| `dlv.funnel_event`       | `funnel_event`           | Audit / Debug                      |
| `dlv.package_id`         | `package_id`             | GA4 + Meta + Ads                   |
| `dlv.persona`            | `persona`                | GA4 + Meta                         |
| `dlv.curriculum_id`      | `curriculum_id`          | GA4                                |
| `dlv.source_page`        | `source_page`            | GA4                                |
| `dlv.page_path`          | `page_path`              | GA4 page_location override         |
| `dlv.value`              | `value`                  | Meta + Ads (checkout/purchase)     |
| `dlv.currency`           | `currency`               | Meta + Ads (default `EUR`)         |
| `dlv.transaction_id`     | `transaction_id`         | Meta `Purchase` + Ads `purchase`   |
| `dlv.order_id`           | `order_id`               | Backup von `transaction_id`        |
| `dlv.cta_location`       | `cta_location`           | GA4 cta_clicked Param              |
| `dlv.quiz_slug`          | `quiz_slug`              | GA4 quiz_started Param             |

> **Constant** anlegen: `const.ga4_id` = `G-XXXXXXX` und `const.meta_pixel_id` = `xxxxxxxxxxxx`.

---

## B. Trigger anlegen

Für jedes GA4-Event aus dem Schema **einen** Custom-Event-Trigger:

| Trigger Name              | Type          | Event name (regex aus)        |
|---------------------------|---------------|-------------------------------|
| `ce.landing_view`         | Custom Event  | `landing_view`                |
| `ce.cta_clicked`          | Custom Event  | `cta_clicked`                 |
| `ce.cta_visible`          | Custom Event  | `cta_visible`                 |
| `ce.pricing_view`         | Custom Event  | `pricing_view`                |
| `ce.quiz_started`         | Custom Event  | `quiz_started`                |
| `ce.quiz_completed`       | Custom Event  | `quiz_completed`              |
| `ce.lead_captured`        | Custom Event  | `lead_captured`               |
| `ce.lernplan_viewed`      | Custom Event  | `lernplan_viewed`             |
| `ce.checkout_started`     | Custom Event  | `checkout_started`            |
| `ce.purchase_completed`   | Custom Event  | `purchase_completed`          |
| `ce.add_to_cart`          | Custom Event  | `add_to_cart`                 |
| `ce.spa_pageview`         | Custom Event  | `spa_pageview`                |
| `ce.consent_update`       | Custom Event  | `consent_update`              |

Optional Engagement-Cluster (eigene Tags, gleicher Trigger-Pattern):
`persona_selected`, `ai_tutor_used`, `oral_exam_started`, `mastery_reached`,
`exam_simulation_started`, `pruefung_begonnen`, `pruefung_abgeschlossen`,
`bestanden`, `nicht_bestanden`, `h5p_started`, `h5p_answered`, `h5p_completed`, `h5p_progress`.

---

## C. Tags anlegen — GA4 (DACH-Property `{{const.ga4_id}}`)

Type = **Google Tag** (Konfiguration) bereits vorhanden mit Trigger `Initialization — All Pages`.
Pro Event ein **GA4 Event Tag**:

| Tag Name                  | GA4 Event Name        | Event Parameters                                                                  | Trigger                  |
|---------------------------|-----------------------|-----------------------------------------------------------------------------------|--------------------------|
| `ga4.landing_view`        | `landing_view`        | `page_path={{dlv.page_path}}`, `persona={{dlv.persona}}`                          | `ce.landing_view`        |
| `ga4.cta_clicked`         | `cta_clicked`         | `cta_location={{dlv.cta_location}}`, `source_page={{dlv.source_page}}`            | `ce.cta_clicked`         |
| `ga4.quiz_started`        | `quiz_started`        | `package_id={{dlv.package_id}}`, `quiz_slug={{dlv.quiz_slug}}`                    | `ce.quiz_started`        |
| `ga4.quiz_completed`      | `quiz_completed`      | `package_id={{dlv.package_id}}`, `persona={{dlv.persona}}`                        | `ce.quiz_completed`      |
| `ga4.lead_captured`       | `lead_captured`       | `package_id={{dlv.package_id}}`, `persona={{dlv.persona}}`                        | `ce.lead_captured`       |
| `ga4.checkout_started`    | `checkout_started`    | `package_id`, `persona`, `value`, `currency`                                      | `ce.checkout_started`    |
| `ga4.purchase_completed`  | `purchase_completed`  | `package_id`, `persona`, `value`, `currency`, `transaction_id`                    | `ce.purchase_completed`  |
| `ga4.add_to_cart`         | `add_to_cart`         | `package_id`, `value`, `currency`                                                 | `ce.add_to_cart`         |
| `ga4.spa_pageview`        | `page_view`           | `page_path={{dlv.page_path}}`, `page_location={{Page URL}}`                       | `ce.spa_pageview`        |

**In GA4 Admin → Conversions** als Conversion markieren:
`quiz_completed`, `checkout_started`, `purchase_completed`.

---

## D. Tags anlegen — Meta Pixel (`{{const.meta_pixel_id}}`)

Base-Pixel-Tag triggert bei `Initialization — All Pages` (mit Consent Check `dlv.consent_ad`).
Ableitungen:

| Tag Name             | Custom HTML / Template Call                                                                                     | Trigger                  | Pflichtfelder                                            |
|----------------------|-----------------------------------------------------------------------------------------------------------------|--------------------------|----------------------------------------------------------|
| `meta.InitiateCheckout` | `fbq('track','InitiateCheckout',{value:{{dlv.value}}, currency:{{dlv.currency}}, content_ids:[{{dlv.package_id}}]})` | `ce.checkout_started`    | `package_id`, `persona`, `value`, `currency`             |
| `meta.Purchase`         | `fbq('track','Purchase',{value:{{dlv.value}}, currency:{{dlv.currency}}, content_ids:[{{dlv.package_id}}]}, {eventID:{{dlv.transaction_id}}})` | `ce.purchase_completed`  | `package_id`, `persona`, `value`, `currency`, `transaction_id` |
| `meta.Lead`             | `fbq('track','Lead',{content_name:{{dlv.persona}}})`                                                            | `ce.lead_captured`       | `persona`                                                |

> `eventID` = Stripe `order_id` → server-side dedupe mit der `stripe-webhook` Fan-out.

---

## E. Tags anlegen — Google Ads (Conversion-ID `AW-XXXXXX`)

| Tag Name                  | Conversion Label    | Trigger                  | Felder                                                |
|---------------------------|---------------------|--------------------------|-------------------------------------------------------|
| `ads.begin_checkout`      | `<label_ic>`        | `ce.checkout_started`    | `value`, `currency`, `transaction_id` (optional)      |
| `ads.purchase`            | `<label_purchase>`  | `ce.purchase_completed`  | `value`, `currency`, `transaction_id` (Pflicht)       |
| `ads.lead`                | `<label_lead>`      | `ce.lead_captured`       | —                                                     |

---

## F. Consent Mode v2

- Default in `index.html` (vor GTM-Loader): alle `*_storage = denied`, region = `EU,DACH`.
- Tag-Settings → **Additional consent checks**:
  - GA4 Tags → benötigt `analytics_storage`
  - Meta + Ads Tags → benötigt `ad_storage` UND `ad_user_data`

---

## G. Verify

1. **Preview Mode** → `/tools/event-inspector` → 5 Buttons klicken → Tags Fired prüfen.
2. **GA4 Realtime** → Events sollten innerhalb von ~30 s erscheinen.
3. **Meta Events Manager → Test Events** → Browser-Code eingeben → `InitiateCheckout` + `Purchase` müssen mit `eventID` ankommen.
4. **CLI** Regression: `node scripts/analytics/validate-events.mjs <(pbpaste)` nach Capture.
