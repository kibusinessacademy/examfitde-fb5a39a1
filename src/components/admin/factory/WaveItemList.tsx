import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface WaveItemListProps {
  items: any[];
  isLoading: boolean;
}

export default function WaveItemList({ items, isLoading }: WaveItemListProps) {
  return (
    <Card>
      <CardHeader><CardTitle>Wave Items ({items.length})</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {items.map((item: any) => (
          <div key={item.id} className="rounded-lg border p-3 space-y-2">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-medium">{item.curriculum_title}</div>
                <div className="text-sm text-muted-foreground">
                  Paket: {item.package_title || item.package_id || "–"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{item.status}</Badge>
                {item.package_status && <Badge variant="outline">pkg: {item.package_status}</Badge>}
                {item.build_progress != null && (
                  <Badge variant="outline">progress: {item.build_progress}%</Badge>
                )}
                <Badge variant="outline">prio: {item.priority ?? 0}</Badge>
              </div>
            </div>

            {item.last_error && (
              <div className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/5 p-2">
                {item.last_error}
              </div>
            )}

            {/* Publish gate */}
            {item.publish_gate && (
              <div className="grid gap-2 md:grid-cols-4 text-xs rounded border p-2 bg-muted/20">
                <div>publish_ok: <span className={item.publish_gate.ok ? "text-green-500" : "text-destructive"}>{String(item.publish_gate.ok)}</span></div>
                <div>failed_steps: {item.publish_gate.failed_steps ?? 0}</div>
                <div>open_jobs: {item.publish_gate.open_jobs ?? 0}</div>
                <div>build_progress: {item.publish_gate.build_progress ?? 0}</div>
                <div>placeholder: {item.publish_gate.placeholder_lessons ?? 0}</div>
                <div>hollow: {item.publish_gate.hollow_lessons ?? 0}</div>
                <div>tutor: {String(item.publish_gate.tutor_ok)}</div>
                <div>exam: {String(item.publish_gate.exam_ok)}</div>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              started: {item.started_at || "–"} · finished: {item.finished_at || "–"} · published: {item.published_at || "–"}
            </div>
          </div>
        ))}

        {items.length === 0 && !isLoading && (
          <div className="text-sm text-muted-foreground">Keine Items gefunden.</div>
        )}
      </CardContent>
    </Card>
  );
}
