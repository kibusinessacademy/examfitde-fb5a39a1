/**
 * RenovateRecommendationCard (with Repo Profile Switcher)
 * ───────────────────────────────────────────────────────
 * Generiert die Renovate-Konfig + Quick-Pin-Patches abhängig vom
 * gewählten Repo-Layout-Profil (default / monorepo / turborepo / custom).
 */
import { useMemo, useState } from "react";
import { Copy, Check, FileCode, Wrench, Folder } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildPatchForUnpinnedAction, renovateOnboardingChecklist } from "@/lib/admin/security/renovateRecommendation";
import {
  REPO_PROFILES,
  buildRenovateConfigForProfile,
  buildPatchPathHint,
  type RepoProfileId,
} from "@/lib/admin/security/repoProfiles";

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

const REPO_PROFILE_KEY = "lov.security.repoProfile";

export function RenovateRecommendationCard() {
  const [copied, setCopied] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<RepoProfileId>(() => {
    if (typeof window === "undefined") return "default";
    return (localStorage.getItem(REPO_PROFILE_KEY) as RepoProfileId) ?? "default";
  });

  const profile = useMemo(
    () => REPO_PROFILES.find((p) => p.id === profileId) ?? REPO_PROFILES[0],
    [profileId],
  );
  const config = useMemo(() => buildRenovateConfigForProfile(profile), [profile]);

  function changeProfile(id: RepoProfileId) {
    setProfileId(id);
    if (typeof window !== "undefined") localStorage.setItem(REPO_PROFILE_KEY, id);
  }

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Card className="border-amber-500/30" data-renovate-card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          Renovate-Empfehlung für „unpinned actions" (P2)
          <Badge variant="outline" className="ml-auto text-[10px]">empfohlen</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Repo-Profil Switcher */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Repo-Layout:</span>
          <Select value={profileId} onValueChange={(v) => changeProfile(v as RepoProfileId)}>
            <SelectTrigger className="h-7 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPO_PROFILES.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">{profile.description}</span>
        </div>

        <p className="text-xs text-muted-foreground">
          SHA-Pinning manuell zu erzwingen erzeugt Wartungsfriktion. Renovate übernimmt
          das Pinnen als kontrollierte PRs (Schedule: <code>{profile.schedule.join(", ")}</code>).
          Vulnerability-Alerts laufen sofort.
        </p>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium">renovate.json (Repo-Root)</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copy(config, "config")}
              className="h-7 px-2"
            >
              {copied === "config" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span className="ml-1 text-xs">Kopieren</span>
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
{config}
          </pre>
          <p className="mt-1 text-[11px] text-muted-foreground">{buildPatchPathHint(profile)}</p>
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
                    <div className="rounded bg-destructive-bg-subtle p-1.5 text-destructive">- {patch.before}</div>
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
