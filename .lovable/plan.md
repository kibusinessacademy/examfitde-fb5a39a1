# Journey 1 P0/P1 Fixes + Audit-Write-Contract

Ziel: Top-of-Funnel reparieren (Checkout, Tracking, RLS, Drift) **und** das strukturelle Problem „schreibt gegen nicht existierende Spalten, wird stillschweigend verworfen" einmal an der Wurzel lösen.

## Phase 0 — Audit-Write-Contract (Wurzel-Fix, zuerst)

Damit kein Folgefix wieder still droppt.

1. **SSOT-Funktion `fn_emit_audit(...)`** (SECURITY DEFINER, einziger erlaubter Schreibpfad in `auto_heal_log` / `ops_guardrail_events` / `conversion_events` / `tracking_events`)
   - Pflicht-Argumente typisiert: `_target_type`, `_action_type`, `_result_status`, `_payload jsonb`, `_correlation_id`
   - Validiert `action_type` gegen Whitelist-View `v_audit_action_registry`
   - Validiert `_payload`-Pflichtfelder via `ops_audit_contract` (action_type → required_jsonb_keys[])
   - **HARD FAIL**: `RAISE EXCEPTION` bei unknown action_type oder fehlenden Pflichtfeldern (kein `EXCEPTION WHEN OTHERS THEN NULL`)
2. **Trigger `trg_audit_write_contract` BEFORE INSERT** auf `auto_heal_log`: wenn Insert **nicht** aus `fn_emit_audit` kommt (session var `audit.via_contract='1'`), → RAISE im Strict-Mode-Flag `app_settings.audit_strict='warn'|'enforce'`. Start mit `warn` + Mirror in `ops_guardrail_events`, nach 48h auf `enforce`.
3. **Registry-Tabelle `ops_audit_contract(action_type, required_keys, schema_version, owner_module)`** + Seeder für die ~21 bereits genutzten action_types.
4. **CI-Guard** `scripts/guards/audit-write-contract-guard.mjs`: greppt nach direktem `INSERT INTO auto_heal_log`/`ops_guardrail_events` außerhalb von `fn_emit_audit` + Allowlist.
5. **Smoke**: 4 Cases — valid, unknown action, missing payload key, malformed jsonb. Erwartung: 1 green, 3 hard fail.

## Phase 1 — P0-1: Bundle-CTA → Checkout

`src/pages/BundleDetail.tsx` (oder gleichwertige Bundle-Route):
- `onClick` ruft **direkt** `supabase.functions.invoke('create-product-checkout', { body: { product_id, persona, source: 'bundle_detail' } })`
- Hard-fail toast wenn `data.url` fehlt + `fn_emit_audit('checkout','checkout_redirect_missing_url','error', payload)`
- Niemals `navigate('/shop')` als Fallback — stattdessen Error-State
- E2E-Smoke `scripts/journey1-bundle-cta-smoke.mjs` (HEAD-Check auf Stripe-Host)

## Phase 2 — P0-2 + P0-3: Tracking-Pipeline

1. Migration: RLS-Policy `tracking_events_anon_insert` (INSERT, anon+authenticated, `WITH CHECK true`, kein SELECT für anon)
2. Enum-Erweiterung `track_conversion_event_v2`: `landing_view` in allowed list (idempotent via `IF NOT EXISTS`)
3. SSOT-View `v_conversion_event_registry` (event_type, required_keys, persona_required) + Contract-Tests
4. `useTrackingClient` ruft bei 401/400 → `fn_emit_audit('tracking','tracking_insert_failed','error', { code, event_type, ... })` statt silent-drop

## Phase 3 — P0-4: Public Product RLS

Migration: explizite anon SELECT-Policies auf `store_products` + `curriculum_products`:
```
USING (is_active = true AND published = true)
```
Sensible Spalten (cost_price, internal_notes) via View `v_store_products_public` + Base-Table SELECT-Deny für anon.

## Phase 4 — P1: 190 vs 166 Catalog-Drift Recon

Diagnose-RPC `admin_get_catalog_visibility_drift()` → liefert pro Paket:
- `published` ✓/✗, `has_active_product` ✓/✗, `has_active_price` ✓/✗, `has_hero_image` ✓/✗, `in_v_full_course_catalog` ✓/✗, `gate_reason text`
- + Cockpit-Card `CatalogVisibilityDriftCard` im /admin/growth Audit-Tab
- **Kein Auto-Fix** — Recon-Report, dann gezielter Heal in Folge-Sprint

## Phase 5 — Verifikation

- Browser-Live: `/bundle/<slug>` → CTA → Stripe URL erreichbar
- `tracking_events` anon-Insert 201
- `track_conversion_event_v2('landing_view', ...)` 200
- `store_products` REST anon 200 mit gefilterten Rows
- `admin_get_catalog_visibility_drift()` liefert 190 Rows, davon ~24 mit non-null gate_reason
- `fn_emit_audit` smoke: 1 ok / 3 hard-fail
- 4 CI-Guards grün

## Technische Notizen

- Migration-Discipline: **5 separate Migrationen** (Contract, CTA-Fix nur Code, Tracking, RLS, Recon-RPC). Jede mit Smoke + Rollback-Hint + `auto_heal_log`-Eintrag via `fn_emit_audit`.
- Audit-Strict startet `warn`, nicht `enforce` — sonst riskieren wir Migration-Block durch Legacy-Inserts. 48h Beobachtung, dann Flip.
- `conversion_events.package_id` Generated Column bleibt SSOT — `fn_emit_audit` validiert nur Wrapper-Pfad.

## Out of Scope (bewusst)

- Journey 2/3/4 Audit (erst nach Entry-Funnel-Reparatur)
- Hero-Layout-Glitch (UX, kein Blocker)
- Direktkauf-CTA auf Produktseite (P1 UX, eigener Sprint)
- 24 Drift-Pakete tatsächlich heilen (erst nach Recon-Daten)
