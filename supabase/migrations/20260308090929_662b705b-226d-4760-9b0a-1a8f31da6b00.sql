
-- Patch 1: Create 4 missing views for E2E audit

CREATE OR REPLACE VIEW public.v_latest_control_plane_snapshot AS
SELECT cps.*
FROM public.control_plane_snapshots cps
ORDER BY cps.created_at DESC
LIMIT 1;

CREATE OR REPLACE VIEW public.v_latest_business_kpi AS
SELECT bks.*
FROM public.business_kpi_snapshots bks
ORDER BY bks.snapshot_date DESC, bks.created_at DESC
LIMIT 1;

CREATE OR REPLACE VIEW public.v_unified_open_alerts AS
SELECT
  'control_plane_alert'::text as source_type,
  cpa.id::text as source_id,
  cpa.severity,
  cpa.status,
  cpa.title,
  cpa.message,
  cpa.source_layer as scope,
  cpa.payload,
  cpa.created_at
FROM public.control_plane_alerts cpa
WHERE cpa.status = 'open'

UNION ALL

SELECT
  'system_probe_alert'::text as source_type,
  spa.id::text as source_id,
  spa.severity,
  spa.status,
  spa.title,
  spa.message,
  'probe'::text as scope,
  spa.payload,
  spa.created_at
FROM public.system_probe_alerts spa
WHERE spa.status = 'open'

UNION ALL

SELECT
  'contract_violation'::text as source_type,
  scv.id::text as source_id,
  scv.severity,
  scv.status,
  scv.violation_type as title,
  scv.message,
  'contracts'::text as scope,
  scv.details as payload,
  scv.created_at
FROM public.system_contract_violations scv
WHERE scv.status = 'open'

UNION ALL

SELECT
  'orphan_execution'::text as source_type,
  soe.id::text as source_id,
  soe.severity,
  soe.status,
  soe.orphan_type as title,
  soe.message,
  'scheduler'::text as scope,
  soe.payload,
  soe.created_at
FROM public.system_orphan_executions soe
WHERE soe.status = 'open';

CREATE OR REPLACE VIEW public.v_latest_probe_run AS
SELECT spr.*
FROM public.system_probe_runs spr
ORDER BY spr.started_at DESC
LIMIT 1;
