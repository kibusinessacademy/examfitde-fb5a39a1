## Welle 2 — Post-Publish Growth Execution + Funnel Tracking Fix

Der Umfang ist groß (≈40 Artefakte, 6 neue Edge Functions, 7 Detectoren, mehrere Migrationen). Ich teile in **vier ausführbare Loops**, damit jeder Loop in sich konsistent shippable ist und du nach jedem Loop entscheiden kannst.

### Loop 1 (P0, dieser Loop) — Funnel-Tracking-Fix

Ziel: `v_funnel_event_loss.status` → OK nach echtem Traffic.

1. **`PruefungstrainingDetailPage` + `ProductDetailPage` + `ProductPage`**
   - `pricing_view` über `trackFunnel('pricing_view', { package_id, curriculum_id, source_page=canonical, page_path, persona })` einmal pro Mount, sobald `packageId` resolved (nicht über IntersectionObserver wie aktuell — der feuert nur in `tracking_events`, nicht in `conversion_events`).
   - CTA-Click → `trackFunnel('cta_clicked', { package_id, ... })` und `trackFunnel('checkout_start', { package_id, ... })` direkt vor `startProductCheckout`.
2. **`startProductCheckout` / `create-product-checkout`**: bereits server-side `checkout_started` — sicherstellen, dass `package_id`, `curriculum_id`, `persona`, `source_page` durchgereicht werden (Audit-Pass).
3. **`stripe-webhook`**: bereits `emitCheckoutCompleteEvent` — verifizieren, dass `purchase_completed` mit `package_id` läuft; falls Drift, fixen.
4. **`gtm.ts` + `FUNNEL_TO_GTM_EVENT`**: Mapping-Coverage prüfen, `pricing_view` + `checkout_start` + `checkout_complete` müssen vorhanden sein (Guard läuft schon).
5. **Smoke**: `scripts/funnel-tracking-smoke.mjs` erweitern um Pricing-Detail-Pfad. Außerdem Migration einer kleinen Validation-RPC `admin_smoke_pricing_funnel_24h` (read-only) für Dashboard-Sichtbarkeit.

Ergebnis: Frontend schreibt jetzt zuverlässig in `conversion_events`. Funnel-Loss kann nur noch durch fehlenden Live-Traffic CRIT bleiben.

### Loop 2 — Worker für 6 neue Job-Types

Pro Job-Type ein Edge-Function-Handler (oder Wiederverwendung):
- `seo_indexnow_submit` → bestehende `seo-submit-indexnow` Function als Worker andocken (Job-Queue-Consumer-Pattern wie `package_auto_generate_seo_suite`).
- `package_post_publish_blog` → neue Edge Function `worker-post-publish-blog` (LLM-generierter Artikel, schreibt `blog_articles` mit `package_id`).
- `package_og_image_generate` → neue Edge Function `worker-og-image-generate` (Lovable AI image, speichert in storage).
- `package_distribution_plan` → neue Edge Function `worker-distribution-plan` (schreibt `package_distribution_plans` Tabelle).
- `package_campaign_assets_generate` → neue Edge Function `worker-campaign-assets` (schreibt `package_campaign_assets`).
- `package_email_sequence_enroll` → neue Edge Function `worker-email-sequence-enroll` (enqueue in `email_delivery_queue`).

Alle Worker: idempotent über `idempotency_key`, schreiben `auto_heal_log`, respektieren `bronze_lock_override`-Verbot.

### Loop 3 — Self-Heal-Detectoren (7 Klassen)

SQL-Views + Cron-Jobs (15min/hourly), schreiben Repair-Jobs zurück in die Queue.

### Loop 4 — Smoke + Abschlussbericht

Erweiterung `b2c-ssot-server-smoke` + neuer Smoke-Runner für Growth-Fanout + Before/After-Metriken.

---

### Empfehlung

**Ich schlage vor, in diesem Loop nur Loop 1 (P0 Funnel-Tracking-Fix) auszuliefern**, weil:
- Funnel-Loss ist akut CRIT — sofortige Wirkung.
- Loop 2 erzeugt 6 neue Edge Functions + neue Tabellen, das ist ein eigener Loop wert (Migration-Discipline).
- Loop 3 + 4 setzen auf Loop 2 auf.

Antworte mit „Loop 1“ um nur P0 zu shippen, oder „alles“ um auch Loop 2–4 in diesem Loop zu erzwingen (höheres Drift-Risiko).
