/**
 * RenovateRecommendationCard
 * ──────────────────────────
 * Zeigt für P2-„unpinned actions" eine Renovate-Konfig + vorbereiteten
 * Patch-Text. Renovate ist die nicht-friktionäre Strategie statt manueller
 * SHA-Pin-Aktionen (die bei jeder Action-Rotation brechen würden).
 */
import { useState } from "react";
import { Copy, Check, FileCode, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RENOVATE_RECOMMENDED_CONFIG,
  buildPatchForUnpinnedAction,
  renovateOnboardingChecklist,
} from "@/lib/admin/security/renovateRecommendation";

const COMMON_USES = [
  "actions/checkout@v4",
  "actions/setup-node@v4",
  "actions/upload-artifact@v4",
  "actions/download-artifact@v4",
  "actions/github-script@v7",
  "denoland/setup-deno@v1",
  "peter-evans/create-pull-request@v6",
  "treosh/lighthouse-ci-action@v12",
];

export function RenovateRecommendationCard() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Card className="border-amber-500/30" data-renovate-card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          Renovate-Empfehlung für „unpinned actions" (P2)
          <Badge variant="outline" className="ml-auto text-[10px]">empfohlen</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          SHA-Pinning manuell zu erzwingen erzeugt Wartungsfriktion. Renovate übernimmt
          das Pinnen als kontrollierte, wöchentliche PRs — Vulnerability-Alerts laufen sofort.
        </p>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium">renovate.json (Repo-Root)</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copy(RENOVATE_RECOMMENDED_CONFIG, "config")}
              className="h-7 px-2"
            >
              {copied === "config" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span className="ml-1 text-xs">Kopieren</span>
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
{RENOVATE_RECOMMENDED_CONFIG}
          </pre>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium">Onboarding-Checkliste</div>
          <ol className="space-y-1 text-xs text-muted-foreground">
            {renovateOnboardingChecklist().map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium">
            <FileCode className="h-3 w-3" /> Vorbereitete Patch-Snippets (Quick-Pin)
          </div>
          <div className="space-y-2">
            {COMMON_USES.map((u) => {
              const patch = buildPatchForUnpinnedAction(u);
              if (!patch) return null;
              return (
                <div key={u} className="rounded-md border border-border bg-muted/20 p-2 text-[11px]">
                  <div className="mb-1 flex items-center justify-between">
                    <code className="font-mono">{u}</code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copy(patch.after, u)}
                      className="h-6 px-2"
                    >
                      {copied === u ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-1 font-mono md:grid-cols-2">
                    <div className="rounded bg-destructive/10 p-1.5 text-destructive">- {patch.before}</div>
                    <div className="rounded bg-emerald-500/10 p-1.5 text-emerald-700 dark:text-emerald-400">
                      + {patch.after}
                    </div>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{patch.comment}</p>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
