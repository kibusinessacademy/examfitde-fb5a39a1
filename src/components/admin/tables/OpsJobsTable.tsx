import type { OpsJobItem } from "@/components/admin/lib/admin-types";
import { formatDateTime } from "@/components/admin/lib/admin-utils";

export function OpsJobsTable({ items }: { items: OpsJobItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Keine Jobs in der Queue.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Job Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Attempts</th>
              <th className="px-4 py-3 font-medium">Package</th>
              <th className="px-4 py-3 font-medium">Error</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.job_id} className="border-t border-border text-foreground">
                <td className="px-4 py-3 font-medium">{item.job_type}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.status === "failed"
                        ? "bg-destructive-bg-subtle text-destructive"
                        : item.status === "processing"
                        ? "bg-blue-500/15 text-blue-400"
                        : item.status === "completed"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {item.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.attempts}/{item.max_attempts}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {item.package_title ? (
                    <span title={item.package_ref ?? undefined}>
                      {item.package_title.replace(/^ExamFit\s*–\s*/, '').split('–')[0].trim()}
                    </span>
                  ) : (
                    <span className="font-mono">{item.package_ref ?? "–"}</span>
                  )}
                </td>
                <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground" title={item.error ?? undefined}>
                  {item.error ?? "–"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDateTime(item.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
