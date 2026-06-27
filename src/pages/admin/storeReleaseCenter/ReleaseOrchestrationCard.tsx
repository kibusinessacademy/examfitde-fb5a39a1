// Release Orchestration Card — STORE.PUBLISH.ORCHESTRATION.OS.1
// Read-only governance UI. Surfaces the active release candidate, hash
// integrity, release policy, and append-only timeline. The only available
// actions are: Create Candidate, Invalidate Candidate, Approve for Submission,
// Export Submission Package. There is NO publish/submit/release/rollout button.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { PackagePlus, Ban, CheckCheck, FileArchive, ShieldCheck } from "lucide-react";

type Candidate = {
  id: string;
  manifest_id: string;
  candidate_version: number;
  version: string;
  status: string;
  manifest_hash: string | null;
  listing_hash: string | null;
  package_hash: string | null;
  build_hash: string | null;
  review_hash: string | null;
  smoke_hash: string | null;
  android_build_reference: string | null;
  ios_build_reference: string | null;
  invalidated_reason: string | null;
  approved_at: string | null;
  exported_at: string | null;
  created_at: string;
};

type TimelineRow = {
  id: string;
  event: string;
  note: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
};

interface Props {
  manifestId: string;
  courseTitle?: string;
}

export function ReleaseOrchestrationCard({ manifestId, courseTitle }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const candidates = useQuery({
    queryKey: ["release-candidates", manifestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_release_candidates" as any)
        .select("*")
        .eq("manifest_id", manifestId)
        .order("candidate_version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Candidate[];
    },
  });

  const active = useMemo(
    () => candidates.data?.find((c) => c.status === "active" || c.status === "approved") ?? null,
    [candidates.data],
  );

  const timeline = useQuery({
    queryKey: ["release-timeline", active?.id ?? manifestId],
    enabled: Boolean(active?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_release_timeline" as any)
        .select("*")
        .eq("candidate_id", active!.id)
        .order("occurred_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TimelineRow[];
    },
  });

  async function invoke(fn: string, body: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success(`${label}: OK`);
      qc.invalidateQueries({ queryKey: ["release-candidates", manifestId] });
      qc.invalidateQueries({ queryKey: ["release-timeline"] });
      return data;
    } catch (e) {
      toast.error(`${label} fehlgeschlagen: ${(e as Error).message}`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function exportPackage() {
    if (!active) return;
    const data = (await invoke(
      "export-store-submission-package",
      { candidate_id: active.id },
      "Export Submission Package",
    )) as { submission_package?: unknown } | null;
    if (data?.submission_package) {
      const blob = new Blob([JSON.stringify(data.submission_package, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `submission-${active.version}-${active.candidate_version}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Release Orchestration {courseTitle ? `— ${courseTitle}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {candidates.isLoading ? (
          <Skeleton className="h-24" />
        ) : !active ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Kein aktiver Release Candidate.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">v{active.version}</Badge>
              <Badge variant="outline">Candidate #{active.candidate_version}</Badge>
              <Badge variant={active.status === "approved" ? "default" : "outline"}>
                {active.status}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono text-muted-foreground">
              <div>manifest_hash: {short(active.manifest_hash)}</div>
              <div>listing_hash: {short(active.listing_hash)}</div>
              <div>package_hash: {short(active.package_hash)}</div>
              <div>build_hash: {short(active.build_hash)}</div>
              <div>review_hash: {short(active.review_hash)}</div>
              <div>smoke_hash: {short(active.smoke_hash)}</div>
            </div>
          </div>
        )}

        <Separator />

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => invoke("create-store-release-candidate", { manifest_id: manifestId }, "Create Candidate")}
          >
            <PackagePlus className="h-4 w-4 mr-1" />
            Create Candidate
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !active || active.status !== "active"}
            onClick={() =>
              invoke(
                "invalidate-store-release-candidate",
                { candidate_id: active!.id, reason: "manual_admin_invalidation" },
                "Invalidate Candidate",
              )
            }
          >
            <Ban className="h-4 w-4 mr-1" />
            Invalidate
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || !active || active.status !== "active"}
            onClick={() => invoke("approve-store-release", { candidate_id: active!.id }, "Approve for Submission")}
          >
            <CheckCheck className="h-4 w-4 mr-1" />
            Approve for Submission
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || !active || active.status !== "approved"}
            onClick={exportPackage}
          >
            <FileArchive className="h-4 w-4 mr-1" />
            Export Submission Package
          </Button>
        </div>

        <Separator />

        <div>
          <div className="text-sm font-semibold mb-2">Release Timeline</div>
          {!active ? (
            <div className="text-xs text-muted-foreground">—</div>
          ) : timeline.isLoading ? (
            <Skeleton className="h-16" />
          ) : (timeline.data ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">Noch keine Events.</div>
          ) : (
            <ol className="space-y-1 text-xs font-mono">
              {timeline.data!.map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <span>{t.event}</span>
                  <span className="text-muted-foreground">{new Date(t.occurred_at).toLocaleString()}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function short(h: string | null): string {
  if (!h) return "—";
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}
