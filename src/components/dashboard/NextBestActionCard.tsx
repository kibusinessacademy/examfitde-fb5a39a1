import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lightbulb } from "lucide-react";

type Action = {
  id: string;
  title: string;
  payload_json: { message?: string; cta?: string; tips?: string[] };
  created_at: string;
};

export function NextBestActionCard() {
  const [item, setItem] = useState<Action | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("growth-actions-api", {
          body: { action: "get_my_action", payload: {} },
        });
        if (!alive) return;
        if (!error && data?.action) setItem(data.action);
      } catch {
        // silent
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  if (loading || !item) return null;

  const p = item.payload_json ?? {};

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Lightbulb className="h-4 w-4" />
          Dein nächster Schritt
        </div>
        <div className="mt-1 text-base font-bold">{item.title}</div>
        {p.message && <p className="mt-2 text-sm text-muted-foreground">{p.message}</p>}
        {Array.isArray(p.tips) && p.tips.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {p.tips.slice(0, 3).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
        <Button variant="default" size="sm" className="mt-3" asChild>
          <a href="/courses">{p.cta ?? "Prüfung starten"}</a>
        </Button>
      </CardContent>
    </Card>
  );
}
