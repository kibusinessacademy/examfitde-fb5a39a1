---
name: security-findings-exceptions-and-renovate-v1
description: Finding-Exceptions sind DB-persistiert (security_finding_exceptions) — Admin-only RLS, optional gebunden an Audit-Version oder Datum. Unpinned-Actions (P2) werden NICHT manuell gepinnt, sondern via Renovate (renovate.json) als kontrollierte wöchentliche PRs.
type: constraint
---

**Pflicht-Pfad für Finding-Akzeptanzen (statt nur Markdown/Memory):**
- Tabelle `public.security_finding_exceptions` (Admin-only RLS).
- Felder: `scanner_name`, `internal_id`, `priority`, `status` (accepted/wontfix/deferred/mitigated), `reason`, `accepted_until_audit`, `accepted_until_date`.
- UI: `/admin/security/findings` → Accordion-Aktion "Als Ausnahme markieren".
- Merge-Logik im Classifier: persistierte Exceptions setzen `ignore=true` und überschreiben den ignore-Reason im Hover.

**SHA-Pinning (P2 unpinned actions) — Strategie:**
- KEIN manuelles Erzwingen von SHA-Pins über alle Workflows.
- `renovate.json` ist im Repo-Root committed mit `helpers:pinGitHubActionDigests`.
- Renovate erzeugt wöchentlich kontrollierte PRs (Schedule "before 6am on monday").
- Vulnerability-Alerts laufen sofort ohne Schedule.
- UI zeigt Quick-Pin-Snippets mit bekannten SHAs als Notfall-Patch (Fallback).

**Workflow-Index:**
- Quelle: `scripts/security/build-workflow-index.mjs` → `public/security/workflow-index.json`.
- Findings-Detailansicht verlinkt automatisch zu betroffenen `.github/workflows/*.yml` + Job-Namen.
- Re-Run nach Workflow-Änderungen pflichtig: `node scripts/security/build-workflow-index.mjs`.

**JSON-Import:**
- Schema-Validierung via Zod (`findingSchema.ts`), akzeptiert Array, `{findings:[]}` und `{scanners:[{findings:[]}]}` Formen.
- Max 5MB Upload.
