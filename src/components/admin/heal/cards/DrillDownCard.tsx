/**
 * DrillDownCard — Paket-Liste pro Blocker-Klasse mit Filter.
 */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { type BlockerKey, useBlockerDashboard } from "./BlockerCountsCard";

interface Props {
  filter: BlockerKey | "ALL";
  onResetFilter: () => void;
}

export function DrillDownCard({ filter, onResetFilter }: Props) {
  const dashboard = useBlockerDashboard();
  const filteredRows = (dashboard.data ?? []).filter(
    (r) => filter === "ALL" || r.primary_blocker === filter,
  );

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">
          Drill-down ({filteredRows.length})
          {filter !== "ALL" && (
            <Badge variant="outline" className="ml-2 text-[10px]">{filter}</Badge>
          )}
        </h3>
        {filter !== "ALL" && (
          <Button variant="ghost" size="sm" onClick={onResetFilter}>
            Filter zurücksetzen
          </Button>
        )}
      </div>
      {dashboard.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="border rounded-md max-h-[600px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Course</TableHead>
                <TableHead className="text-xs">Track</TableHead>
                <TableHead className="text-xs">Blocker</TableHead>
                <TableHead className="text-xs">Defer-Reason</TableHead>
                <TableHead className="text-xs">Approved Q</TableHead>
                <TableHead className="text-xs">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((r) => (
                <TableRow key={r.package_id}>
                  <TableCell className="text-xs max-w-[300px] truncate" title={r.course_title ?? ""}>
                    {r.course_title}
                  </TableCell>
                  <TableCell className="text-xs">{r.package_track}</TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className="text-[10px]">{r.primary_blocker}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.defer_reason ?? r.reason_code ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs font-mono tabular-nums">
                    {r.approved_exam_questions ?? 0}
                  </TableCell>
                  <TableCell className="text-[10px] text-muted-foreground">
                    {r.updated_at ? new Date(r.updated_at).toLocaleString("de-DE") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
