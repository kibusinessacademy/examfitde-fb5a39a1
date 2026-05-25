---
name: Berufs-KI Phase 2 — SSOT-Bindung + Tier-Enforcement
description: competency_id/blueprint_id, tier-aware RPC berufs_ki_user_can_run, Admin-CRUD, Premium-Lock UI, structured Output-Sektionen, Heal-Stats RPC.
type: feature
---

# Berufs-KI Phase 2 — SSOT Binding & Monetarisierung

## Schema (Erweiterung)
- `berufs_ki_workflow_definitions.competency_id uuid` (singular primary)
- `berufs_ki_workflow_definitions.blueprint_id uuid` (singular primary)
- Bestand `competency_ids uuid[]` + `blueprint_refs jsonb` bleiben als Mehrfach-Bezug.

## RPCs
- `berufs_ki_user_can_run(p_user_id, p_workflow_id) → (allowed, reason, tier_required)` SECURITY DEFINER. Free=immer ok. Pro/Business: Admin-Bypass oder `check_product_access_by_curriculum` auf bound curriculum, sonst beliebiger active grant.
- `admin_berufs_ki_list_workflows()` SECURITY DEFINER, has_role-gated. Liefert SSOT-Bindings + runs_total/runs_24h/ok_rate/last_run_at.

## Edge `berufs-ki-run` Hardening
1. Tier-Gate via RPC vor allem anderen → 403 `entitlement_required` mit reason+tier_required.
2. Daily-Limit nur für Free-Tier, zählt nur ok-Läufe.
3. `tier_at_run` aus Gate-Result, konsistent in allen Audit-Zweigen.

## Frontend
- `WorkflowRunner` zeigt Tier-Badge, Lock-Icon, SSOT-Chips (📦 Lernpaket, 📚 Lernfeld, 🎯 Kompetenz, 🧩 Blueprint), Lock-Overlay mit CTA (`/paket`, `/work` für Business), parsed Output-Sektionen aus `output_schema.sections`.
- `BerufsKIWorkbenchPage`: Card-Liste markiert Locked-Workflows + Curriculum-Badge.
- Admin `/admin/berufs-ki/workflows`: Tabelle (Title, Tier, SSOT-Bindung, runs_24h, ok_rate, Status), Toggle-Active, Create/Edit-Dialog (Slug, Title, Kategorie, Tier, Risiko, Curriculum/LF/Kompetenz/Blueprint IDs, System+User Prompt, Input-Schema JSON).

## Bewusst NICHT umgesetzt
- Kein dedizierter Run-History-Drawer für Endnutzer (Phase 3).
- Keine Auto-Curriculum-Mapping aus `useOsBeruf` (slug→curriculum_id Bridge fehlt; folgt mit OS-Identity v2).
- Kein admin-side Workflow-Versioning (version-Spalte bleibt manueller Knopf).
- Keine separate competency/blueprint Lookup-UI — IDs werden als UUID-String eingegeben (Phase 3 Picker).
