import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import type { ExecutiveSummary } from "@/lib/offer-comparison/types";

export function AIExecutiveSummary({ summary }: { summary: ExecutiveSummary }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">AI Executive Summary</Badge>
              </div>
              <h2 className="text-xl font-semibold leading-tight">{summary.headline}</h2>
              <ul className="space-y-1.5 text-sm text-muted-foreground leading-relaxed">
                {summary.body.map((line, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary mt-0.5">›</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              {summary.watchouts.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Watchouts</div>
                  <ul className="space-y-1 text-sm">
                    {summary.watchouts.map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
