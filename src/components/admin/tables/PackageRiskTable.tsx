import type { PackageRiskItem } from "@/components/admin/lib/admin-types";

export function PackageRiskTable({ items }: { items: PackageRiskItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Keine Risiko-Pakete gefunden.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Paket</th>
              <th className="px-4 py-3 font-medium">Curriculum</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Step</th>
              <th className="px-4 py-3 font-medium">Stall</th>
              <th className="px-4 py-3 font-medium">Integrity</th>
              <th className="px-4 py-3 font-medium">Placeholders</th>
              <th className="px-4 py-3 font-medium">Publish</th>
              <th className="px-4 py-3 font-medium">Risk</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.package_id} className="border-t border-border text-foreground">
                <td className="px-4 py-3 font-medium">{item.package_title}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.curriculum_title ?? "–"}</td>
                <td className="px-4 py-3">{item.status}</td>
                <td className="px-4 py-3">{item.current_step ?? "–"}</td>
                <td className="px-4 py-3">
                  {item.stall_minutes != null ? `${item.stall_minutes} min` : "–"}
                </td>
                <td className="px-4 py-3">
                  {item.integrity_passed == null
                    ? "–"
                    : item.integrity_passed
                    ? <span className="text-emerald-400">ok</span>
                    : <span className="text-rose-400">fail</span>}
                </td>
                <td className="px-4 py-3">{item.placeholder_count ?? "–"}</td>
                <td className="px-4 py-3">
                  {item.publish_ready == null
                    ? "–"
                    : item.publish_ready
                    ? <span className="text-emerald-400">ready</span>
                    : <span className="text-amber-400">blocked</span>}
                </td>
                <td className="px-4 py-3 font-semibold text-amber-400">{item.risk_score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
