/**
 * PublishBlockerClustersBanner — Cockpit-Cluster-Übersicht
 * Aggregierte Top-Level-Sicht auf alle Publish-Blocker, gruppiert nach
 * primary_blocker × package_track × track_violation_code.
 * Liest aus public.v_admin_publish_blocker_clusters.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, CheckCircle2, Pause } from "lucide-react";

type ClusterRow = {
  primary_blocker: string;
  package_track: string;
  track_violation_code: string;
  package_count: number;
  empty_integrity_reports: number;
  integrity_failed_count: number;
  integrity_deferred_count: number;
  oldest_updated_at: string | null;
  newest_updated_at: string | null;
  sample_courses: string[] | null;
};

const blockerStyle: Record<string, { icon: typeof AlertTriangle; tone: string; label: string }> = {
  INTEGRITY_NEVER_CHECKED: { icon: Clock, tone: "bg-muted text-muted-foreground", label: "Noch nicht geprüft" },
  INTEGRITY_DEFERRED: { icon: Pause, tone: "bg-secondary text-secondary-foreground", label: "Deferred (wartet auf Daten)" },
  INTEGRITY_REPORT_MISSING: { icon: AlertTriangle, tone: "bg-destructive-bg-subtle text-destructive", label: "Report fehlt" },
  INTEGRITY_FAILED: { icon: AlertTriangle, tone: "bg-destructive text-destructive-foreground", label: "Integrity Failed" },
  QUALITY_COUNCIL_PENDING: { icon: Clock, tone: "bg-secondary text-secondary-foreground", label: "Quality Council offen" },
  MISSING_LEARNING: { icon: AlertTriangle, tone: "bg-destructive-bg-subtle text-destructive", label: "Lerninhalt fehlt" },
  MISSING_MINICHECKS: { icon: AlertTriangle, tone: "bg-destructive-bg-subtle text-destructive", label: "Minichecks fehlen" },
  MISSING_HANDBOOK: { icon: AlertTriangle, tone: "bg-destructive-bg-subtle text-destructive", label: "Handbuch fehlt" },
  MISSING_TUTOR_INDEX: { icon: AlertTriangle, tone: "bg-destructive-bg-subtle text-destructive", label: "Tutor-Index fehlt" },
  EXAM_POOL_TOO_SMALL: { icon: AlertTriangle, tone: "bg-destructive-bg-subtle text-destructive", label: "Prüfungspool zu klein" },
  OK: { icon: CheckCircle2, tone: "bg-primary/15 text-primary", label: "OK" },
};

export function PublishBlockerClustersBanner() {
  const [rows, setRows] = useState<ClusterRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("v_admin_publish_blocker_clusters")
        .select("*")
        .order("package_count", { ascending: false });
      if (!active) return;
      if (error) {
        console.error("[PublishBlockerClustersBanner] load failed", error);
        setRows([]);
      } else {
        setRows((data ?? []) as unknown as ClusterRow[]);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-4 w-48 mb-3" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }

  const totalBlocked = (rows ?? [])
    .filter((r) => r.primary_blocker !== "OK")
    .reduce((s, r) => s + r.package_count, 0);

  const totalEmpty = (rows ?? []).reduce((s, r) => s + r.empty_integrity_reports, 0);
  const totalDeferred = (rows ?? []).reduce((s, r) => s + r.integrity_deferred_count, 0);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold">Publish-Blocker Cluster</h3>
          <p className="text-xs text-muted-foreground">
            Aggregierte Sicht auf alle building/publish_ready/published Pakete
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Badge variant="outline">Blocked: {totalBlocked}</Badge>
          <Badge variant="outline">Empty Reports: {totalEmpty}</Badge>
          <Badge variant="outline">Deferred: {totalDeferred}</Badge>
          <a
            href="/admin/ops/blocker-ops"
            className="text-xs text-primary hover:underline ml-2"
          >
            Steuerstand öffnen →
          </a>
        </div>
      </div>

      {(!rows || rows.length === 0) ? (
        <p className="text-sm text-muted-foreground">Keine Daten verfügbar.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, idx) => {
            const style = blockerStyle[r.primary_blocker] ?? {
              icon: AlertTriangle,
              tone: "bg-muted text-muted-foreground",
              label: r.primary_blocker,
            };
            const Icon = style.icon;
            return (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 py-2 px-3 rounded-md border bg-card"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`p-1.5 rounded-md ${style.tone}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {style.label}
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        {r.package_track}
                      </span>
                      {r.track_violation_code !== "none" && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">
                          {r.track_violation_code}
                        </Badge>
                      )}
                    </div>
                    {r.sample_courses && r.sample_courses.length > 0 && (
                      <div className="text-xs text-muted-foreground truncate">
                        {r.sample_courses.slice(0, 2).join(" · ")}
                        {r.sample_courses.length > 2 && ` +${r.sample_courses.length - 2}`}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary" className="font-mono">
                    {r.package_count}
                  </Badge>
                  {r.empty_integrity_reports > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {r.empty_integrity_reports} ohne Report
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
