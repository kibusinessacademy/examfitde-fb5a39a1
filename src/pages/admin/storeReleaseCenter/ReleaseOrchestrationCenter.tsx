// Release Orchestration Center — STORE.PUBLISH.ORCHESTRATION.OS.1
// Wraps the per-manifest orchestration card with a manifest picker so the
// admin can drive any course's release lifecycle.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ReleaseOrchestrationCard } from "./ReleaseOrchestrationCard";
import { StoreLifecycleCard } from "./StoreLifecycleCard";
import { StoreOpsHealthCard } from "./StoreOpsHealthCard";

type ManifestRow = {
  id: string;
  course_id: string | null;
  version_name: string | null;
  bundle_id: string | null;
};

export function ReleaseOrchestrationCenter() {
  const [manifestId, setManifestId] = useState<string | null>(null);

  const manifests = useQuery({
    queryKey: ["release-orchestration-manifests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mobile_course_app_manifest" as any)
        .select("id, course_id, version_name, bundle_id")
        .order("version_name", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ManifestRow[];
    },
  });

  const selected = useMemo(
    () => manifests.data?.find((m) => m.id === manifestId) ?? null,
    [manifests.data, manifestId],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Release Orchestration Center</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <StoreOpsHealthCard />
        {manifests.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <Select value={manifestId ?? ""} onValueChange={(v) => setManifestId(v || null)}>
            <SelectTrigger>
              <SelectValue placeholder="Manifest wählen…" />
            </SelectTrigger>
            <SelectContent>
              {(manifests.data ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.bundle_id ?? m.id} — v{m.version_name ?? "0.0.0"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {selected && (
          <>
            <ReleaseOrchestrationCard
              manifestId={selected.id}
              courseTitle={selected.bundle_id ?? undefined}
            />
            <StoreLifecycleCard manifestId={selected.id} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
