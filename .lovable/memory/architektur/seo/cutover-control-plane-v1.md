---
name: Cutover Control Plane v1
description: admin-cutover-control Edge Fn + CutoverPanel Tab in Leitstelle (GSC Sitemap submit/status, Route-HTML-Smoke, Audit, Runbook). CI Workflow post-deploy-go-status. Audit nach auto_heal_log (cutover_*).
type: feature
---

# Cutover Control Plane

## SSOT-Komponenten
- **Edge Fn `admin-cutover-control`** (admin-only via has_role):
  - `gsc_submit_sitemap` → PUT GSC-API via Connector-Gateway
  - `gsc_get_sitemap_status` → GET GSC-API
  - `gsc_list_sites` → GET sites
  - `route_html_smoke` / `run_post_cutover_smoke` → fetch Live-HTML, parse title/canonical/JSON-LD/desc, Verdict GO|BLOCKED
- **UI**: `src/components/admin/command/CutoverPanel.tsx` als Tab `cutover` in `LeitstellePage` (`/admin/command`). Tabs: Smoke · GSC · Audit · Runbook (inline ReactMarkdown via `?raw`).
- **Runbook SSOT**: `docs/runbooks/cutover-rollback.md` (Pre-Gates, DNS-Switch 76.76.21.21 / cname.vercel-dns.com, Rollback 185.158.133.1, Validierung).
- **CLI Smoke**: `scripts/seo/route-html-verify.mjs` (`--host` `--routes`, exit 0=GO/1=BLOCKED). Bestehendes `post-cutover-smoke.mjs` bleibt.
- **CI Workflow**: `.github/workflows/post-deploy-go-status.yml` — Trigger workflow_dispatch + repository_dispatch(`vercel-deploy-success`) + hourly. Step Summary + Artifact + auto-Issue bei BLOCKED (außer manuell).

## Audit-Action-Types (warn-only, ohne ops_audit_contract-Eintrag)
- `cutover_gsc_sitemap_submit`
- `cutover_route_html_smoke`
- `cutover_control_error`

## Anti-Drift
- Keine neue Admin-Route — strikt als Tab in Leitstelle (`/admin/command`).
- Audit landet in `auto_heal_log.metadata` (NICHT `details`).
- GSC-Calls IMMER über Connector-Gateway (LOVABLE_API_KEY + GOOGLE_SEARCH_CONSOLE_API_KEY), nie direkt.
