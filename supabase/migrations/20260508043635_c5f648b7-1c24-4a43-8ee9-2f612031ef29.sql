
-- WIP Cap auf 160 erhöhen — Konfigurations-Update in ops_pipeline_config
-- Betrifft alle Pipeline-Limiter: WIP-Total, WIP-Limit und max_concurrent_packages

UPDATE public.ops_pipeline_config
SET value = '160'
WHERE key = 'wip_total_cap';

UPDATE public.ops_pipeline_config
SET value = '160'
WHERE key = 'wip_limit';

UPDATE public.ops_pipeline_config
SET value = '160'
WHERE key = 'max_concurrent_packages';

-- Bonus-Slots auf 0 setzen, damit effective_cap exakt 160 bleibt
-- (Tail-Phase-Exclusion bleibt aktiv: Pakete ohne generate_*-Steps zählen nicht)
UPDATE public.ops_pipeline_config
SET value = '0'
WHERE key = 'wip_bonus_slots';

-- Audit-Log des Konfigurations-Wechsels
INSERT INTO public.admin_actions (action, scope, payload)
VALUES (
  'wip_cap_increase',
  'ops_pipeline_config',
  jsonb_build_object(
    'wip_total_cap', 160,
    'wip_limit', 160,
    'max_concurrent_packages', 160,
    'wip_bonus_slots', 0,
    'previous_wip_total_cap', 35,
    'previous_wip_limit', 30,
    'previous_max_concurrent_packages', 15,
    'previous_wip_bonus_slots', 32,
    'reason', 'Bulk-Wellen-Durchlauf: Cap auf 160 erhöht'
  )
);

-- Rückgabe der aktuellen Werte zur Verifikation
SELECT
  key,
  value,
  updated_at
FROM public.ops_pipeline_config
WHERE key IN ('wip_total_cap','wip_limit','max_concurrent_packages','wip_bonus_slots')
ORDER BY key;
