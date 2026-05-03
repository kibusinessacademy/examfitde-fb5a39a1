import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Rocket, Search } from "lucide-react";

interface Row {
  id: string;
  created_at: string;
  package_id: string | null;
  package_title: string | null;
  reason: string | null;
  previous_status: string | null;
  build_progress: number | null;
  cancelled_jobs: number | null;
  admin_user: string | null;
  admin_email: string | null;
  result_detail: string | null;
}

/**
 * Admin-only audit feed for `admin_force_publish` events.
 * Filterbar nach Paket-Titel, Reason, Admin-Email, Package-ID.
 */
export function ForcePublishLogPanel() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-force-publish-log"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_force_publish_log" as never, {
        p_limit: 200,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) =>
      [r.package_title, r.reason, r.admin_email, r.package_id, r.previous_status]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [data, search]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Force-Publish Audit-Log</h3>
          <Badge variant="outline" className="text-[10px]">{data?.length ?? 0}</Badge>
        </div>
        <div className="relative w-[260px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Paket, Reason, Admin, ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          Keine Force-Publish-Events.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="text-left py-1.5 px-2">Wann</th>
                <th className="text-left py-1.5 px-2">Paket</th>
                <th className="text-left py-1.5 px-2">Vorher</th>
                <th className="text-right py-1.5 px-2">Progress</th>
                <th className="text-right py-1.5 px-2">Cancelled</th>
                <th className="text-left py-1.5 px-2">Admin</th>
                <th className="text-left py-1.5 px-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b hover:bg-muted/30">
                  <td className="py-1.5 px-2 font-mono text-[10px] whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("de-DE")}
                  </td>
                  <td className="py-1.5 px-2">
                    <div className="font-medium">{r.package_title ?? "—"}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {r.package_id?.slice(0, 8) ?? "—"}
                    </div>
                  </td>
                  <td className="py-1.5 px-2">
                    <Badge variant="outline" className="text-[10px]">{r.previous_status ?? "?"}</Badge>
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.build_progress ?? "—"}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.cancelled_jobs ?? 0}</td>
                  <td className="py-1.5 px-2 text-[11px]">
                    {r.admin_email ?? <span className="font-mono text-muted-foreground">{r.admin_user?.slice(0, 8) ?? "—"}</span>}
                  </td>
                  <td className="py-1.5 px-2 text-[11px] text-muted-foreground max-w-[280px] truncate" title={r.reason ?? ""}>
                    {r.reason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
