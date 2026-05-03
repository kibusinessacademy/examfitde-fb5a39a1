import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert, Filter, Search } from "lucide-react";

interface HardBlockEvent {
  id: string;
  created_at: string;
  package_id: string;
  transition_source: string | null;
  block_reason: string | null;
  application_name: string | null;
  usename: string | null;
  client_addr: string | null;
  caller_query: string | null;
  package_title: string | null;
  package_status: string | null;
  build_progress: number | null;
}

const fmtTime = (s: string) =>
  new Date(s).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

export function HardBlockEventsPanel() {
  const [hours, setHours] = useState("24");
  const [reason, setReason] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-hard-block-events", hours],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_hard_block_events" as never,
        { p_hours: Number(hours), p_limit: 500 } as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as HardBlockEvent[];
    },
    refetchInterval: 30_000,
  });

  const reasons = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach(r => r.block_reason && set.add(r.block_reason));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    return (data ?? []).filter(r => {
      if (reason !== "all" && r.block_reason !== reason) return false;
      if (search) {
        const s = search.toLowerCase();
        return [r.package_id, r.transition_source, r.application_name, r.usename, r.client_addr, r.caller_query, r.package_title]
          .filter(Boolean).some(x => String(x).toLowerCase().includes(s));
      }
      return true;
    });
  }, [data, reason, search]);

  const bySource = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => {
      const k = r.transition_source ?? "unknown_trigger";
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  return (
    <Card className="p-4 space-y-3 border-destructive/40">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldAlert className="h-4 w-4 text-destructive" />
        <h3 className="text-sm font-semibold">Hard-Block: building → queued</h3>
        <Badge variant="outline" className="text-[10px]">{filtered.length}/{data?.length ?? 0}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Select value={hours} onValueChange={setHours}>
            <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Letzte 1h</SelectItem>
              <SelectItem value="6">Letzte 6h</SelectItem>
              <SelectItem value="24">Letzte 24h</SelectItem>
              <SelectItem value="72">Letzte 72h</SelectItem>
            </SelectContent>
          </Select>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <Filter className="h-3 w-3 mr-1" /><SelectValue placeholder="Reason" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Reasons</SelectItem>
              {reasons.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="package/source/app…"
              className="pl-7 h-8 text-xs w-[220px]"
            />
          </div>
        </div>
      </div>

      {bySource.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {bySource.map(([src, n]) => (
            <Badge key={src} variant="secondary" className="text-[10px] font-mono">
              {src} · {n}
            </Badge>
          ))}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-32" />
      ) : filtered.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          ✅ Keine hard_block_building_to_queued Events im gewählten Zeitraum.
        </div>
      ) : (
        <div className="space-y-2 max-h-[480px] overflow-auto">
          {filtered.map(r => (
            <div key={r.id} className="border border-border-subtle rounded-md p-2.5 text-xs space-y-1.5 bg-surface-1">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="font-semibold">
                  {r.package_title ?? r.package_id}
                  {r.package_status && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      {r.build_progress ?? 0}% · {r.package_status}
                    </Badge>
                  )}
                </div>
                <span className="font-mono text-muted-foreground">{fmtTime(r.created_at)}</span>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground break-all">{r.package_id}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <div><span className="text-muted-foreground">Source:</span>{" "}
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {r.transition_source ?? "unknown_trigger"}
                  </Badge>
                </div>
                <div><span className="text-muted-foreground">Reason:</span>{" "}
                  <Badge variant="destructive" className="text-[10px]">{r.block_reason}</Badge>
                </div>
                <div><span className="text-muted-foreground">App:</span> {r.application_name ?? "—"}</div>
                <div><span className="text-muted-foreground">User:</span> {r.usename ?? "—"}</div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Client:</span> {r.client_addr ?? "—"}
                </div>
              </div>
              {r.caller_query && (
                <details className="text-[10px]">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Caller-Query anzeigen
                  </summary>
                  <pre className="mt-1 p-2 bg-surface-2 rounded font-mono whitespace-pre-wrap break-all">
                    {r.caller_query}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
