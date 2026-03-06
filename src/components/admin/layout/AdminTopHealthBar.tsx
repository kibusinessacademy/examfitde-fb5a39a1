import type { GlobalHealthItem } from "@/components/admin/lib/admin-types";
import { toneClasses } from "@/components/admin/lib/admin-utils";

export function AdminTopHealthBar({ items }: { items: GlobalHealthItem[] }) {
  return (
    <div className="sticky top-0 z-30 -mx-4 mb-4 overflow-x-auto border-b border-border bg-card/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex min-w-max gap-2">
        {items.map((item) => (
          <div
            key={item.key}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${toneClasses(item.tone)}`}
            title={item.hint ?? undefined}
          >
            <span className="mr-2 opacity-80">{item.label}</span>
            <span className="font-semibold">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
