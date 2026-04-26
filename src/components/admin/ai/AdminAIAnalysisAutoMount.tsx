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

  const clean = pathname.replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean); // ["admin", "<area>", "<sub?>", ...]

  const area = parts[1];
  const sub = parts[2];
  const sub2 = parts[3];

  if (!area) return { key: "admin/cockpit", label: "Admin (Root)" };

  const params = new URLSearchParams(search);
  const tab = params.get("tab");

  // Friendly labels per (sub-)area
  const PATH_LABEL: Record<string, string> = {
    "admin/cockpit": "Cockpit",
    "admin/command": "Leitstelle",
    "admin/studio": "Kurse & Pakete",
    "admin/queue": "Queue & Heal",
    "admin/growth": "Growth",
    "admin/support": "Support",
    "admin/kpi": "KPIs",
    "admin/test": "Test-Area",
    "admin/jobs/timeline": "Job-Timeline",
    "admin/security/findings": "Security Findings",
    "admin/runbook/integrity-check": "Integrity Runbook",
    "admin/ops/integrity-diff": "Integrity Diff",
    "admin/ops/heal-settings": "Heal-Strategien",
    "admin/ops/step-done-audit": "Step-Done-Audit",
    "admin/ops/stale-marker-diff": "Stale-Marker-Diff",
    "admin/ops/ai-analysis-audit": "KI-Analyse Audit",
    "admin/heal-cockpit": "Heal-Cockpit",
  };

  // Build the longest matching base path (admin/area[/sub[/sub2]])
  const candidates = [
    sub2 ? `admin/${area}/${sub}/${sub2}` : null,
    sub ? `admin/${area}/${sub}` : null,
    `admin/${area}`,
  ].filter(Boolean) as string[];

  const baseKey = candidates.find((c) => PATH_LABEL[c]) ?? `admin/${area}`;
  const key = tab ? `${baseKey}#${tab}` : baseKey;
  const label = (PATH_LABEL[baseKey] ?? area) + (tab ? ` · ${tab}` : "");
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
