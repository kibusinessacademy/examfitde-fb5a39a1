# COURSE.PROFIT.OS.1 — Course Profitability Cockpit

**Status:** Active · **Version:** course-profit-os-1.0.0 · **Cut:** Welle 1 (Foundation + Cockpit)

## Mission
Deterministische Unit-Economics pro Kurspaket für interne Content-Operators. Beantwortet:
„Welche Pakete verdienen Geld? Wo verbrennen wir Produktionszeit? Welcher Hebel zuerst?"

## Architektur (Freeze-konform)
- **+1 Edge Function:** `evaluate-course-profitability` (admin-only via `requireAdmin`).
- **+1 Tabelle:** `course_profitability_snapshots` — append-only (Trigger `trg_cps_no_update` blockt UPDATE/DELETE außer service_role), RLS admin-read.
- **+1 UI-Route:** `/admin/governance/course-profitability`.
- **Pure SSOT:** `supabase/functions/_shared/courseProfitability/index.ts` — keine DB, kein Clock-Drift im Projector, keine Mutation.

## Datenflüsse
- **Inputs:** `v_public_sellable_courses` (module/lesson counts, published_at) + `order_items` × `orders` (paid/refunded/fulfilled im Fenster).
- **Cost-Modell (default):** AI = lessons × 0,35 €; Build = modules × 12 min × 60 €/h; Overhead = 2 €.
- **Revenue-Modell:** Stripe-Fee bekannt → übernommen; sonst geschätzt 1,4 % + 0,25 €/tx.
- **Klassifikation:** `winner` (Marge>0 ∧ Ratio≥0,4), `building` (Marge>0), `loser` (Marge<0 ∨ Refund>25 %), `long_tail` (0 Verkäufe ∧ >60 Tage), `insufficient_data`.

## Empfehlungen (Whitelist, read-only)
`SCALE` · `BUNDLE_CANDIDATE` · `PRICE_EXPERIMENT` · `FREEZE_PRODUCTION` · `REVIVE` · `HOLD` · `INVESTIGATE_REFUNDS`.
System schreibt **nie** zurück in Produkte/Stripe. Operator entscheidet.

## Idempotenz
`inputs_hash` (djb2 über deterministische Felder + Version) ist unique → Re-Runs ohne neue Inputs produzieren `23505` → als `skipped_idempotent` zurückgemeldet.

## Tests
27 Unit-Tests in `src/__tests__/course-profitability/evaluator.test.ts` (Cost, Revenue, Classify, Recommend, Confidence, Determinismus, Payback).

## Bekannte Lücken (Welle 2-Kandidaten)
- Stripe-Fee-Ist (orders.stripe_fee_cents) ist optional — wenn alle Orders sie tragen, geschätzte Fees komplett deaktivieren.
- AI-Kosten heute heuristisch — später aus `ai_token_ledger` (falls vorhanden) joinen.
- Cron-Wrapper für täglichen Auto-Snapshot.
- Drill-down: Trend pro Produkt über letzte N Snapshots.
