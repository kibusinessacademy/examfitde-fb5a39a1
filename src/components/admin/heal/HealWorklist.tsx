import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useHealWorklist, useSmartHealBulk } from "./hooks";
import { HealWorklistRow } from "./HealWorklistRow";
import { PackageDrawer } from "./PackageDrawer";
import { GuidedRecoveryModal } from "./GuidedRecoveryModal";
import { useToast } from "@/hooks/use-toast";
import type {
  ActionabilityClass,
  HealWorklistFilters,
  HealWorklistRow as Row,
  RecommendedAction,
  ReleaseClass,
} from "./types";
import type { BulkOverrideAction } from "./api";
import { ACTION_LABEL } from "./types";
import { Loader2, Sparkles } from "lucide-react";

const ACTIONS: Array<RecommendedAction | "all"> = [
  "all",
  "hard_rebuild",
  "guided_recovery",
  "mark_content_gap",
  "force_publish",
  "bulk_reconcile",
  "monitor",
  "manual_review",
];

const ACTIONABILITIES: Array<ActionabilityClass | "all"> = [
  "all",
  "auto",
  "modal",
  "confirm",
  "observe",
];

const RELEASE_CLASSES: Array<ReleaseClass | "all"> = [
  "all",
  "release_ok",
  "release_warn",
  "release_block",
];

export function HealWorklist() {
  const [filters, setFilters] = useState<HealWorklistFilters>({
    recommended_action: "all",
    actionability_class: "all",
    release_class: "all",
    search: "",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [guidedId, setGuidedId] = useState<string | null>(null);
  const { toast } = useToast();
  const { data, isLoading, error } = useHealWorklist(filters);
  const bulk = useSmartHealBulk();

  const rows = data ?? [];

  const autoSelectableIds = useMemo(
    () => rows.filter((r) => r.actionability_class === "auto").map((r) => r.package_id),
    [rows],
  );

  const selectedAutoIds = useMemo(
    () =>
      Array.from(selected).filter((id) =>
        autoSelectableIds.includes(id),
      ),
    [selected, autoSelectableIds],
  );

  // Normalize once — used for button labels, hint, and submit. Avoids drift.
  const BULK_LIMIT = 25;
  const effectiveSelectedAutoIds = useMemo(
    () => selectedAutoIds.slice(0, BULK_LIMIT),
    [selectedAutoIds],
  );

  const allAutoSelected =
    autoSelectableIds.length > 0 &&
    autoSelectableIds.every((id) => selected.has(id));

  const toggleAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        autoSelectableIds.forEach((id) => next.add(id));
      } else {
        autoSelectableIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  };

  const runBulk = async (overrideAction?: BulkOverrideAction) => {
    const ids = effectiveSelectedAutoIds;
    if (ids.length === 0) {
      toast({
        title: "Keine auto-fähigen Pakete ausgewählt",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await bulk.mutateAsync({
        packageIds: ids,
        action: overrideAction,
      });
      toast({
        title: "Bulk-Heal abgeschlossen",
        description: `executed: ${res.executed.length} · skipped: ${res.skipped.length} · modal: ${res.needs_modal.length} · confirm: ${res.needs_confirmation.length}`,
      });
      setSelected(new Set());
    } catch (e) {
      toast({
        title: "Bulk-Heal fehlgeschlagen",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const runSingle = async (row: Row) => {
    if (row.actionability_class === "modal") {
      setGuidedId(row.package_id);
      return;
    }
    if (row.actionability_class !== "auto") {
      toast({
        title: `${ACTION_LABEL[row.recommended_action]} erfordert ${row.actionability_class === "confirm" ? "Bestätigung" : "Beobachtung"}`,
        description: "Wird in v1 noch nicht silent ausgeführt.",
      });
      return;
    }
    try {
      const res = await bulk.mutateAsync({ packageIds: [row.package_id] });
      const ex = res.executed[0];
      const sk = res.skipped[0];
      toast({
        title: ex ? "Aktion ausgeführt" : "Übersprungen",
        description: ex
          ? `${ACTION_LABEL[row.recommended_action]} → ${ex.result}`
          : sk?.reason ?? "kein Ergebnis",
        variant: ex ? "default" : "destructive",
      });
    } catch (e) {
      toast({
        title: "Aktion fehlgeschlagen",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              Heal-Worklist
              {data && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {data.length} Pakete
                </span>
              )}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={filters.search ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
                placeholder="Suche Titel / ID …"
                className="h-8 w-44"
              />
              <Select
                value={filters.recommended_action ?? "all"}
                onValueChange={(v) =>
                  setFilters({
                    ...filters,
                    recommended_action: v as RecommendedAction | "all",
                  })
                }
              >
                <SelectTrigger className="h-8 w-44">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a === "all" ? "Alle Actions" : ACTION_LABEL[a as RecommendedAction]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.actionability_class ?? "all"}
                onValueChange={(v) =>
                  setFilters({
                    ...filters,
                    actionability_class: v as ActionabilityClass | "all",
                  })
                }
              >
                <SelectTrigger className="h-8 w-36">
                  <SelectValue placeholder="Class" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONABILITIES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a === "all" ? "Alle Klassen" : a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={(filters.release_class as string) ?? "all"}
                onValueChange={(v) =>
                  setFilters({
                    ...filters,
                    release_class: v === "all" ? "all" : (v as ReleaseClass),
                  })
                }
              >
                <SelectTrigger className="h-8 w-36">
                  <SelectValue placeholder="Release" />
                </SelectTrigger>
                <SelectContent>
                  {RELEASE_CLASSES.map((r) => (
                    <SelectItem key={String(r)} value={String(r)}>
                      {r === "all" ? "Alle Releases" : r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedAutoIds.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm">
                <strong>{effectiveSelectedAutoIds.length}</strong>
                {selectedAutoIds.length > BULK_LIMIT
                  ? ` von ${selectedAutoIds.length}`
                  : ""}{" "}
                auto-fähige Pakete ausgewählt
                {selectedAutoIds.length > BULK_LIMIT && (
                  <span className="ml-1 text-destructive">
                    (Limit {BULK_LIMIT} — nur die ersten werden gesendet)
                  </span>
                )}
              </span>
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelected(new Set())}
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runBulk("bulk_reconcile")}
                  disabled={bulk.isPending}
                  title="Erzwingt Reconcile-Artefakte für alle ausgewählten auto-Pakete"
                >
                  Force Reconcile ({effectiveSelectedAutoIds.length})
                </Button>
                <Button
                  size="sm"
                  onClick={() => runBulk()}
                  disabled={bulk.isPending}
                >
                  {bulk.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  Smart Heal ({effectiveSelectedAutoIds.length})
                </Button>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="p-4 text-sm text-destructive">
              Fehler: {error instanceof Error ? error.message : String(error)}
            </div>
          ) : isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Keine Pakete für diese Filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allAutoSelected}
                        onCheckedChange={(v) => toggleAll(!!v)}
                        disabled={autoSelectableIds.length === 0}
                        aria-label="Alle auto-fähigen auswählen"
                      />
                    </TableHead>
                    <TableHead className="w-16">Score</TableHead>
                    <TableHead>Paket / Kurs</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Release</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Signale</TableHead>
                    <TableHead>Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <HealWorklistRow
                      key={row.package_id}
                      row={row}
                      selected={selected.has(row.package_id)}
                      onSelect={(checked) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(row.package_id);
                          else next.delete(row.package_id);
                          return next;
                        });
                      }}
                      onOpen={() => setOpenId(row.package_id)}
                      onAction={() => runSingle(row)}
                      busy={bulk.isPending}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PackageDrawer
        packageId={openId}
        rows={rows}
        onClose={() => setOpenId(null)}
        onAction={(row) => runSingle(row)}
      />
    </>
  );
}
