import { useLocation } from "react-router-dom";
import { useMemo } from "react";
import AdminAIAnalysisPanel from "./AdminAIAnalysisPanel";

/**
 * Maps the current /admin/* URL to a stable, snapshot-loader-aware route_key.
 * Tabs are read from ?tab= query string when present, so each tab gets its own
 * history bucket and snapshot.
 */
function deriveRouteKey(pathname: string, search: string): { key: string; label: string } | null {
  if (!pathname.startsWith("/admin")) return null;

  // Normalize: strip trailing slash, get first 3 segments
  const clean = pathname.replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean); // ["admin", "<area>", "<sub?>"]

  const area = parts[1];
  const sub = parts[2];

  if (!area) return { key: "admin/cockpit", label: "Admin (Root)" };

  const params = new URLSearchParams(search);
  const tab = params.get("tab");

  // Known top-level admin areas
  const AREA_LABEL: Record<string, string> = {
    cockpit: "Cockpit",
    command: "Leitstelle",
    studio: "Kurse & Pakete",
    queue: "Queue & Heal",
    growth: "Growth",
    support: "Support",
    kpi: "KPIs",
    test: "Test-Area",
    "package-diagnostics": "Package-Diagnose",
    "heal-strategy": "Heal-Strategien",
    "security-findings": "Security",
    "integrity-runbook": "Integrity Runbook",
    "integrity-diff": "Integrity Diff",
    "job-timeline": "Job-Timeline",
    "step-done-audit": "Step-Done-Audit",
    "stale-marker-diff": "Stale-Marker-Diff",
    "humor-qc": "Humor-QC",
  };

  const baseKey = `admin/${area}`;
  const key = tab ? `${baseKey}#${tab}` : sub ? `${baseKey}/${sub}` : baseKey;

  const label = (AREA_LABEL[area] || area) + (tab ? ` · ${tab}` : sub ? ` · ${sub}` : "");
  return { key, label };
}

export function AdminAIAnalysisAutoMount() {
  const location = useLocation();
  const route = useMemo(
    () => deriveRouteKey(location.pathname, location.search),
    [location.pathname, location.search],
  );
  if (!route) return null;

  return (
    <div className="my-4">
      <AdminAIAnalysisPanel
        routeKey={route.key}
        routePath={location.pathname + location.search}
        title={`KI-Qualitätsanalyse · ${route.label}`}
      />
    </div>
  );
}

export default AdminAIAnalysisAutoMount;
