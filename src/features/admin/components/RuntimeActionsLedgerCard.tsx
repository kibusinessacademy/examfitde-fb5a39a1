import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, Eye, ShieldAlert, ShieldCheck, Undo2, Hash } from "lucide-react";
import RuntimeEvidenceDrawer from "./RuntimeEvidenceDrawer";
import type { RuntimeActionHistoryRow } from "../runtime/types";

const RISK_TONE: Record<string, string> = {
  LOW: "bg-status-bg-subtle-success text-status-fg-success",
  MEDIUM: "bg-status-bg-subtle-warning text-status-fg-warning",
  HIGH: "bg-status-bg-subtle-danger text-status-fg-danger",
  CRITICAL: "bg-destructive text-destructive-foreground",
};

const STATUS_TONE: Record<string, string> = {
  completed: "bg-status-bg-subtle-success text-status-fg-success",
  running: "bg-status-bg-subtle-info text-status-fg-info",
  pending: "bg-muted text-muted-foreground",
  failed: "bg-status-bg-subtle-danger text-status-fg-danger",
  rolled_back: "bg-status-bg-subtle-warning text-status-fg-warning",
  cancelled: "bg-muted text-muted-foreground",
};

export default function RuntimeActionsLedgerCard() {
  const [status, setStatus] = useState<string>("all");
  const [risk, setRisk] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["runtime-action-history", status, risk, search],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_runtime_action_history" as never, {
        _limit: 200,
        _status_filter: status === "all" ? null : status,
        _risk_filter: risk === "all" ? null : risk,
        _action_filter: null,
        _search: search || null,
      } as never);
      if (error) throw error;
      return (data ?? []) as RuntimeActionHistoryRow[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Runtime Actions Ledger</CardTitle>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search action / target…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="rolled_back">Rolled back</SelectItem>
            </SelectContent>
          </Select>
          <Select value={risk} onValueChange={setRisk}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted/30" />
            ))}
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No runtime actions in the selected window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-1.5 pr-2">When</th>
                  <th className="pr-2">Action</th>
                  <th className="pr-2">Target</th>
                  <th className="pr-2">Status</th>
                  <th className="pr-2">Risk</th>
                  <th className="pr-2">Duration</th>
                  <th className="pr-2">Flags</th>
                  <th className="pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {data!.map((row) => (
                  <tr key={row.runtime_action_id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="py-1.5 pr-2 font-mono text-[11px]">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="pr-2 font-medium">{row.action_type}</td>
                    <td className="pr-2 font-mono text-[11px] text-muted-foreground">
                      {row.target_id ? row.target_id.slice(0, 12) : "—"}
                    </td>
                    <td className="pr-2">
                      <Badge variant="outline" className={`text-[10px] ${STATUS_TONE[row.status] ?? ""}`}>
                        {row.status}
                      </Badge>
                    </td>
                    <td className="pr-2">
                      <Badge variant="outline" className={`text-[10px] ${RISK_TONE[row.risk_level] ?? ""}`}>
                        {row.risk_level}
                      </Badge>
                    </td>
                    <td className="pr-2 font-mono text-[11px]">
                      {row.duration_ms != null ? `${row.duration_ms}ms` : "—"}
                    </td>
                    <td className="pr-2">
                      <div className="flex gap-1">
                        {row.idempotency_key && (
                          <Badge variant="secondary" className="gap-1 text-[10px]" title="Idempotency key present">
                            <Hash className="h-3 w-3" />idem
                          </Badge>
                        )}
                        {row.rollback_available && (
                          <Badge variant="secondary" className="gap-1 text-[10px]" title="Rollback ref present">
                            <Undo2 className="h-3 w-3" />rb
                          </Badge>
                        )}
                        {row.dangerous_action && (
                          <Badge variant="secondary" className="gap-1 text-[10px]" title="Dangerous action">
                            <ShieldAlert className="h-3 w-3" />risk
                          </Badge>
                        )}
                        {!row.dangerous_action && row.status === "completed" && (
                          <ShieldCheck className="h-3 w-3 text-status-fg-success" />
                        )}
                      </div>
                    </td>
                    <td className="pr-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setActiveId(row.runtime_action_id)}
                      >
                        <Eye className="mr-1 h-3 w-3" />Evidence
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!activeId} onOpenChange={(o) => !o && setActiveId(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Runtime Action Evidence</DialogTitle>
          </DialogHeader>
          {activeId && <RuntimeEvidenceDrawer actionId={activeId} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
