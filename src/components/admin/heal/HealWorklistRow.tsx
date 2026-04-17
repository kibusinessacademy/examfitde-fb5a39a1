import { TableCell, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ActionabilityBadge, RecommendedActionButton } from "./RecommendedActionButton";
import type { HealWorklistRow as Row } from "./types";

interface Props {
  row: Row;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
  onAction: () => void;
  busy?: boolean;
}

function urgencyTone(score: number) {
  if (score >= 90) return "bg-destructive/15 text-destructive border-destructive/30";
  if (score >= 70) return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  if (score >= 50) return "bg-primary/10 text-primary border-primary/20";
  return "bg-muted text-muted-foreground border-border";
}

function releaseTone(rc: Row["release_class"]) {
  if (rc === "release_ok") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (rc === "release_warn") return "bg-amber-500/10 text-amber-600 border-amber-500/20";
  if (rc === "release_block") return "bg-destructive/10 text-destructive border-destructive/20";
  return "bg-muted text-muted-foreground border-border";
}

export function HealWorklistRow({
  row,
  selected,
  onSelect,
  onOpen,
  onAction,
  busy,
}: Props) {
  const isAuto = row.actionability_class === "auto";
  return (
    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onOpen}>
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          disabled={!isAuto}
          onCheckedChange={(v) => onSelect(!!v)}
          aria-label="Paket auswählen"
        />
      </TableCell>
      <TableCell className="w-16">
        <Badge variant="outline" className={`font-mono ${urgencyTone(row.urgency_score)}`}>
          {row.urgency_score}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[280px]">
        <div className="truncate font-medium text-sm">
          {row.package_title ?? "—"}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {row.course_title ?? row.curriculum_id ?? row.package_id.slice(0, 8)}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-[10px] capitalize">
          {row.package_status ?? "—"}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={`text-[10px] ${releaseTone(row.release_class)}`}>
          {row.release_class ?? "n/a"}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <ActionabilityBadge value={row.actionability_class} />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
          {row.deficiency_codes && row.deficiency_codes.length > 0 ? (
            <span className="text-destructive">
              {row.deficiency_codes.length} def
            </span>
          ) : null}
          {row.exhausted_steps > 0 && (
            <span className="text-amber-600">exh: {row.exhausted_steps}</span>
          )}
          {row.processing_jobs > 0 && (
            <span className="text-primary">proc: {row.processing_jobs}</span>
          )}
          {row.pending_jobs > 0 && <span>pend: {row.pending_jobs}</span>}
          {row.failed_jobs_24h > 0 && (
            <span className="text-destructive">fail24h: {row.failed_jobs_24h}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="w-[200px]" onClick={(e) => e.stopPropagation()}>
        <RecommendedActionButton
          action={row.recommended_action}
          actionability={row.actionability_class}
          onClick={onAction}
          disabled={busy}
        />
      </TableCell>
    </TableRow>
  );
}
