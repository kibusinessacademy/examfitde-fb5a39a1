# Memory: architektur/sicherheit/anon-privilege-lockdown-v1
Updated: 2026-04-22

## P0 Hotfix: Anon-Privilege Lockdown

**Vor Fix:** anon hatte SELECT/INSERT/UPDATE/DELETE auf >300 public.* Objekte (RLS schützte, aber Defense-in-Depth verletzt). Bestätigte Datenleaks per curl mit anon-Key:
- `v_admin_packages_ssot`, `v_admin_heal_cockpit`, `v_admin_morning_briefing` → komplette interne Pipeline-Daten
- `kpi_admin_nav_badges`, `v_admin_growth_overview`, `work_v_affiliate_sales` → Admin-KPIs + Affiliate-Umsätze
- `api_keys`, `affiliate_payouts`, `user_roles` → Tabellen-Grants (RLS hielt, aber EXECUTE auf admin_* SECURITY DEFINER fns offen für anon)

**Fix (Migration 20260422_*):**
1. REVOKE ALL FROM anon auf alle public.* außer Whitelist
2. Whitelist: courses, certification_catalog, curricula, learning_fields, course_packages, blog_posts, blog_articles, pricing_*, marketing_*, seo_*, v_homepage_course_catalog, v_product_page_*, v_full_course_catalog, v_learner_visible_exam_simulations, etc.
3. REVOKE EXECUTE auf alle SECURITY DEFINER public.* Funktionen von anon + PUBLIC
4. ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL FROM anon (TABLES/SEQUENCES/FUNCTIONS) → künftige Objekte sind standardmäßig nicht öffentlich

**Verifikation:** anon → 401 auf v_admin_*, api_keys, user_roles. anon → 200 auf courses, certification_catalog, v_homepage_course_catalog, blog_posts.

## Folge-Härtung (TODO)
- Linter zeigt 274× "Security Definer View" — Views per CREATE OR REPLACE ohne SECURITY DEFINER neu erstellen, oder umstellen auf `security_invoker = true` (PG15+).
- authenticated-Rolle prüfen: Welche Admin-Views sind unnötig für non-admin authenticated lesbar?
- supabase/functions/*: alle Edge Functions auf JWT-Verify und admin-guard prüfen (`requireAdmin` aus `_shared/adminGuard.ts` konsequent verwenden).
