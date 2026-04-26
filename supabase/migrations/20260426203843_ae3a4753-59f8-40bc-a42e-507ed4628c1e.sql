-- Wrapper-View für Publish-Readiness mit Council-Defer-Aware-Feldern
-- Strategie: statt die komplexe Hauptview erneut zu überschreiben, bauen wir
-- eine schlanke Wrapper-Schicht. UI/Cockpit nutzen die effective_*-Spalten.

CREATE OR REPLACE VIEW public.v_admin_publish_readiness_effective AS
SELECT
  r.*,
  (d.package_id IS NOT NULL) AS quality_council_deferred,
  d.defer_reason AS quality_council_defer_reason,
  d.error_codes AS quality_council_defer_error_codes,
  d.deferred_at AS quality_council_deferred_at,
  CASE
    WHEN d.package_id IS NOT NULL THEN 'done'::text
    ELSE r.quality_council_status
  END AS effective_quality_council_status,
  CASE
    WHEN d.package_id IS NOT NULL
      AND r.integrity_passed = true
      AND r.primary_blocker = 'QUALITY_COUNCIL_PENDING'
    THEN 'READY_WITH_COUNCIL_DEFER'
    ELSE r.primary_blocker
  END AS effective_primary_blocker,
  -- Convenience-Flag für UI: Paket effektiv freigabefähig (inkl. Council-Defer)
  CASE
    WHEN r.publish_ready = true THEN true
    WHEN d.package_id IS NOT NULL
      AND r.integrity_passed = true
      AND r.primary_blocker = 'QUALITY_COUNCIL_PENDING'
    THEN true
    ELSE false
  END AS effective_publish_ready
FROM public.v_admin_publish_readiness r
LEFT JOIN public.v_council_deferred_packages d
  ON d.package_id = r.package_id;

GRANT SELECT ON public.v_admin_publish_readiness_effective TO authenticated;

COMMENT ON VIEW public.v_admin_publish_readiness_effective IS
'Wrapper über v_admin_publish_readiness. Liefert effective_*-Spalten, die
Council-Defer-Status berücksichtigen, ohne die Hauptview zu modifizieren.
Cockpit/BlockerOps/Publish-UI MÜSSEN diese View nutzen, nicht die Basis.';