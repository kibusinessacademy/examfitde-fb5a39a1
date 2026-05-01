/**
 * PermanentFixBacklogCard — Permanent-Fix Backlog im Heal-Hub
 * ────────────────────────────────────────────────────────────
 * Zeigt offene/in-progress KI-Permanent-Fix-Vorschläge die der
 * Admin als Tasks gespeichert hat. Ermöglicht Status-/Prio-Update.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Wrench, CheckCircle2, ExternalLink, Loader2, X, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Link } from "react-router-dom";

type FixTask = {
  id: string;
  recommendation_id: string | null;
  pattern_key: string;
  cluster: string;
  package_id: string | null;
  package_title: string | null;
  title: string;
  description: string;
  status: "open" | "in_progress" | "done" | "wontfix";
  priority: "low" | "medium" | "high" | "critical";
  notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  age_hours: number;
};

const STATUS_FILTERS: Record<string, string[]> = {
  active: ["open", "in_progress"],
  done: ["done"],
  all: ["open", "in_progress", "done", "wontfix"],
};

const prioColor = (p: FixTask["priority"]) =>
  p === "critical"
    ? "destructive"
    : p === "high"
      ? "default"
      : "secondary";

export function PermanentFixBacklogCard() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<keyof typeof STATUS_FILTERS>("active");

  const { data, isLoading, error } = useQuery({
    queryKey: ["heal-permanent-fix-tasks", filter],
    queryFn: async (): Promise<FixTask[]> => {
      const { data, error } = await supabase.rpc(
        "admin_list_permanent_fix_tasks" as never,
        { p_status_filter: STATUS_FILTERS[filter], p_limit: 100 } as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as FixTask[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  const updateMutation = useMutation({
    mutationFn: async (vars: {
      id: string;
      status?: FixTask["status"];
      priority?: FixTask["priority"];
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc(
        "admin_update_permanent_fix_task" as never,
        {
          p_task_id: vars.id,
          p_status: vars.status ?? null,
          p_priority: vars.priority ?? null,
          p_notes: vars.notes ?? null,
        } as never,
      );
      if (error) throw error;
      const d = data as { error?: string };
      if (d?.error) throw new Error(d.error);
    },
    onSuccess: () => {
      toast.success("Aktualisiert");
      qc.invalidateQueries({ queryKey: ["heal-permanent-fix-tasks"] });
    },
    onError: (e: Error) =>
      toast.error("Update fehlgeschlagen", { description: e.message }),
  });

  const open = data?.filter((t) => t.status === "open").length ?? 0;
  const inProg = data?.filter((t) => t.status === "in_progress").length ?? 0;
  const done = data?.filter((t) => t.status === "done").length ?? 0;

  return (
    <Card className="border-emerald-500/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Permanent-Fix Backlog
            {open + inProg > 0 && (
              <Badge variant="secondary" className="ml-1">
                {open + inProg} offen
              </Badge>
            )}
          </CardTitle>
          <Select value={filter} onValueChange={(v) => setFilter(v as keyof typeof STATUS_FILTERS)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktiv</SelectItem>
              <SelectItem value="done">Erledigt</SelectItem>
              <SelectItem value="all">Alle</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          KI-vorgeschlagene Permanent-Fixes als Aufgabenliste. Aus „Wiederkehrende Cluster" via „In Backlog speichern".
        </p>
        {data && data.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
            <span>{open} offen</span>
            <span>{inProg} in Arbeit</span>
            <span>{done} erledigt</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="text-destructive font-medium">Backlog konnte nicht geladen werden</div>
            <div className="text-xs text-muted-foreground font-mono break-all mt-1">
              {(error as Error).message}
            </div>
          </div>
        ) : !data || data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            ✓ Kein Permanent-Fix offen.
          </div>
        ) : (
          data.map((t) => (
            <TaskRow
              key={t.id}
              t={t}
              onUpdate={(vars) => updateMutation.mutate({ id: t.id, ...vars })}
              isUpdating={
                updateMutation.isPending && updateMutation.variables?.id === t.id
              }
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function TaskRow({
  t, onUpdate, isUpdating,
}: {
  t: FixTask;
  onUpdate: (vars: {
    status?: FixTask["status"];
    priority?: FixTask["priority"];
    notes?: string;
  }) => void;
  isUpdating: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border bg-muted/20 p-3 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={prioColor(t.priority)} className="text-[10px]">
                {t.priority.toUpperCase()}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                {t.cluster}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {t.status === "in_progress" ? "in Arbeit" : t.status === "open" ? "offen" : t.status}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {Math.round(t.age_hours)}h alt
              </span>
            </div>
            <div className="text-sm font-medium truncate">
              {t.package_title ?? <span className="text-muted-foreground italic">kein Paket</span>}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 items-end">
            <Select
              value={t.priority}
              onValueChange={(v) => onUpdate({ priority: v as FixTask["priority"] })}
              disabled={isUpdating}
            >
              <SelectTrigger className="h-7 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            {t.package_id && (
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <Link to={`/admin/studio/${t.package_id}`}>
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Studio
                </Link>
              </Button>
            )}
          </div>
        </div>

        <CollapsibleTrigger asChild>
          <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
            {open ? "Details ausblenden" : "Fix-Vorschlag anzeigen"}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="text-xs whitespace-pre-wrap rounded border bg-background p-2.5">
            {t.description}
          </div>
        </CollapsibleContent>

        <div className="flex items-center gap-2 pt-1 border-t flex-wrap">
          {t.status === "open" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onUpdate({ status: "in_progress" })}
              disabled={isUpdating}
            >
              In Arbeit nehmen
            </Button>
          )}
          {(t.status === "open" || t.status === "in_progress") && (
            <>
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => onUpdate({ status: "done" })}
                disabled={isUpdating}
              >
                {isUpdating ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                )}
                Erledigt
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => onUpdate({ status: "wontfix" })}
                disabled={isUpdating}
              >
                <X className="h-3 w-3 mr-1" />
                Won't fix
              </Button>
            </>
          )}
          {(t.status === "done" || t.status === "wontfix") && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => onUpdate({ status: "open" })}
              disabled={isUpdating}
            >
              Wieder öffnen
            </Button>
          )}
        </div>
      </div>
    </Collapsible>
  );
}
