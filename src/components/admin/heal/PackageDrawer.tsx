import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ActionabilityBadge, RecommendedActionButton } from "./RecommendedActionButton";
import type { HealWorklistRow as Row } from "./types";
import { ACTION_DESCRIPTION, ACTION_LABEL } from "./types";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

interface Props {
  packageId: string | null;
  rows: Row[];
  onClose: () => void;
  onAction: (row: Row) => void;
}

function fmt(date: string | null) {
  if (!date) return "—";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: de });
  } catch {
    return date;
  }
}

export function PackageDrawer({ packageId, rows, onClose, onAction }: Props) {
  const row = rows.find((r) => r.package_id === packageId) ?? null;

  return (
    <Sheet open={!!packageId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle className="text-base">
                {row.package_title ?? "Unbenanntes Paket"}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {row.course_title ?? "—"} ·{" "}
                <span className="font-mono">{row.package_id.slice(0, 8)}…</span>
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-5 text-sm">
              {/* Recommended action panel */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Empfohlene Aktion
                  </div>
                  <ActionabilityBadge value={row.actionability_class} />
                </div>
                <div className="text-base font-semibold">
                  {ACTION_LABEL[row.recommended_action]}
                </div>
                <div className="text-xs text-muted-foreground">
                  {ACTION_DESCRIPTION[row.recommended_action]}
                </div>
                <RecommendedActionButton
                  action={row.recommended_action}
                  actionability={row.actionability_class}
                  onClick={() => onAction(row)}
                />
              </div>

              {/* Why this action */}
              <section>
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Warum diese Aktion?
                </div>
                {row.recommended_action_reasons.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">
                    Keine spezifischen Signale.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {row.recommended_action_reasons.map((r) => (
                      <Badge
                        key={r}
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        {r}
                      </Badge>
                    ))}
                  </div>
                )}
              </section>

              <Separator />

              {/* State */}
              <section className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <div className="font-medium">{row.package_status ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Release</div>
                  <div className="font-medium">{row.release_class ?? "n/a"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Published</div>
                  <div className="font-medium">
                    {row.is_published ? "ja" : "nein"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Urgency</div>
                  <div className="font-medium">{row.urgency_score}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Blocked Reason</div>
                  <div className="font-medium">{row.blocked_reason ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Exhausted Steps</div>
                  <div className="font-medium">{row.exhausted_steps}</div>
                </div>
              </section>

              {/* Deficiencies */}
              {row.deficiency_codes && row.deficiency_codes.length > 0 && (
                <section>
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Deficiency Codes ({row.deficiency_codes.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {row.deficiency_codes.map((c) => (
                      <Badge
                        key={c}
                        variant="outline"
                        className="bg-destructive/10 text-destructive border-destructive/30 text-[10px]"
                      >
                        {c}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {/* Open jobs */}
              <section>
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Offene Jobs
                </div>
                {Object.keys(row.open_jobs_by_type).length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">
                    Keine offenen Jobs
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(row.open_jobs_by_type).map(([type, n]) => (
                      <Badge
                        key={type}
                        variant="outline"
                        className="text-[10px] font-mono"
                      >
                        {type} · {n}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                  <span>processing: {row.processing_jobs}</span>
                  <span>pending: {row.pending_jobs}</span>
                  <span>failed 24h: {row.failed_jobs_24h}</span>
                  <span>repair active: {row.active_repair_jobs}</span>
                  <span>reconcile active: {row.active_reconcile_jobs}</span>
                  <span>repair attempts: {row.repair_attempts_proxy}</span>
                </div>
              </section>

              {/* Activity */}
              <section className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Letzter Step</div>
                  <div className="font-medium">{fmt(row.last_step_change)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Letztes Processing</div>
                  <div className="font-medium">{fmt(row.last_processing_at)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Paket aktualisiert</div>
                  <div className="font-medium">{fmt(row.package_updated_at)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Curriculum</div>
                  <div className="font-mono text-[10px]">
                    {row.curriculum_id?.slice(0, 8) ?? "—"}…
                  </div>
                </div>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
