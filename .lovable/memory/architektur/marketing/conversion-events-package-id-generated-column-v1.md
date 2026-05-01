---
name: conversion_events.package_id Generated Column SSOT
description: Top-level package_id auf conversion_events als STORED generated column aus metadata->>'package_id'. Bevorzugter Lesepfad für Guards/Reports/Smoke.
type: feature
---

# conversion_events.package_id — Generated Column

## Schema
- `conversion_events.package_id uuid GENERATED ALWAYS AS (safe_uuid_from_text(metadata->>'package_id')) STORED`
- Helper `safe_uuid_from_text(text) returns uuid` — IMMUTABLE, fail-safe (returns NULL bei invalid UUID statt zu crashen).
- Indizes: `idx_conversion_events_package_id` (partial WHERE NOT NULL), `idx_conversion_events_event_package_created` (event_type, package_id, created_at DESC).

## Vorprüfung (Baseline 2026-05-01)
- 52 Events total, 15 mit `metadata.package_id`, davon 0 invalid UUIDs, 15 JSON `null` → 0 echte Projection-Fehler.
- `failed_projection_strict = 0` (Events mit String-Wert ≠ '' aber package_id IS NULL).

## Lesepfad-SSOT
1. Bevorzugt: `package_id` (top-level Spalte) — automatisch projiziert, indexiert, joinable.
2. Fallback: `metadata->>'package_id'` — bleibt erhalten für Backwards-Kompatibilität bestehender Konsumenten.

## Guards/Smokes angepasst
- `scripts/checkout-tracking-smoke.mjs` liest jetzt `package_id ?? metadata.package_id` und akzeptiert top-level als Erfüllung der Pflichtfeld-Prüfung.

## Producer-Hinweis
Edge functions (`track-funnel-event`, `create-product-checkout`, `stripe-webhook`) schreiben weiterhin `metadata.package_id`. Die generated column zieht den Wert automatisch nach. **Neue Producer dürfen nicht direkt in `package_id` schreiben** — die Spalte ist GENERATED.

## Migration
`supabase/migrations/20260501094815_*.sql` — additive Änderung, kein Datenverlust, kein Backfill nötig.
