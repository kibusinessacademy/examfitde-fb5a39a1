import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReleaseClassBadge } from "./ReleaseClassBadge";
import type { ReleaseClass } from "@/features/admin/api/releaseClassificationApi";

type Row = {
  package_id: string;
  package_status: string;
  release_class: ReleaseClass;
  deficiency_codes: string[] | null;
  approved_questions: number;
  total_learning_fields: number;
  covered_learning_fields: number;
  course_title: string | null;
};

const CLASS_FILTERS: Array<{ key: "all" | ReleaseClass; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "release_block", label: "🛑 Block" },
  { key: "release_warn", label: "⚠️ Warn" },
  { key: "release_ok", label: "✅ OK" },
];

const STATUS_FILTERS = ["all", "building", "published", "queued", "blocked"] as const;

export function ReleaseClassificationTable() {
  const [classFilter, setClassFilter] = useState<"all" | ReleaseClass>("all");
  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_FILTERS)[number]>("building");
  const [codeFilter, setCodeFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["release-classification-all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_package_release_classification")
        .select(
          "package_id, package_status, release_class, deficiency_codes, approved_questions, total_learning_fields, covered_learning_fields, course_title",
        );
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
    staleTime: 30_000,
  });

  const allCodes = useMemo(() => {
    const s = new Set<string>();
    (data ?? []).forEach((r) => (r.deficiency_codes ?? []).forEach((c) => s.add(c)));
    return Array.from(s).sort();
  }, [data]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (classFilter !== "all") rows = rows.filter((r) => r.release_class === classFilter);
    if (statusFilter !== "all") rows = rows.filter((r) => r.package_status === statusFilter);
    if (codeFilter) rows = rows.filter((r) => (r.deficiency_codes ?? []).includes(codeFilter));
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.course_title ?? "").toLowerCase().includes(q) ||
          r.package_id.toLowerCase().includes(q),
      );
    }
    return rows.sort((a, b) => {
      const order: Record<string, number> = { release_block: 0, release_warn: 1, release_ok: 2 };
      const d = (order[a.release_class] ?? 9) - (order[b.release_class] ?? 9);
      if (d !== 0) return d;
      return (a.course_title ?? "").localeCompare(b.course_title ?? "");
    });
  }, [data, classFilter, statusFilter, codeFilter, search]);

  const counts = useMemo(() => {
    const c = { all: 0, release_block: 0, release_warn: 0, release_ok: 0 } as Record<string, number>;
    (data ?? []).forEach((r) => {
      if (statusFilter === "all" || r.package_status === statusFilter) {
        c.all++;
        c[r.release_class]++;
      }
    });
    return c;
  }, [data, statusFilter]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Release-Klassifikation</h2>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            SSOT: v_package_release_classification · {filtered.length} / {data?.length ?? 0}
          </p>
        </div>
        <Filter className="h-4 w-4 text-text-tertiary" />
      </div>

      <div className="p-3 space-y-2 border-b border-border">
        <Input
          placeholder="Suche Titel oder Package-ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 text-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          {CLASS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setClassFilter(f.key)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
                classFilter === f.key
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/50 text-text-tertiary hover:bg-muted",
              )}
            >
              {f.label}
              <span className="ml-1 text-[10px] opacity-60">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                statusFilter === s
                  ? "bg-foreground/10 text-foreground"
                  : "bg-muted/30 text-text-tertiary hover:bg-muted",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {allCodes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setCodeFilter("")}
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-mono",
                codeFilter === ""
                  ? "bg-primary/10 text-primary"
                  : "bg-surface-sunken text-text-tertiary hover:bg-muted",
              )}
            >
              alle Codes
            </button>
            {allCodes.map((c) => (
              <button
                key={c}
                onClick={() => setCodeFilter(c)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-mono border border-border-subtle",
                  codeFilter === c
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-surface-sunken text-text-tertiary hover:bg-muted",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <div className="p-4 text-sm text-destructive">Fehler: {(error as Error).message}</div>
      ) : isLoading ? (
        <div className="p-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-tertiary">Keine Einträge.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-sunken text-text-tertiary">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Kurs</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Klasse / Codes</th>
                <th className="text-right px-3 py-2 font-medium">Q</th>
                <th className="text-right px-3 py-2 font-medium">LF</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.package_id}
                  className="border-t border-border-subtle hover:bg-muted/30 transition-colors"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground truncate max-w-[280px]">
                      {r.course_title ?? "—"}
                    </div>
                    <div className="text-[10px] text-text-tertiary font-mono">
                      {r.package_id.slice(0, 8)}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                      {r.package_status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <ReleaseClassBadge
                      releaseClass={r.release_class}
                      codes={r.deficiency_codes}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {r.approved_questions}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {r.covered_learning_fields}/{r.total_learning_fields}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to={`/admin/studio/${r.package_id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Detail <ArrowRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
