/**
 * repoProfiles
 * ────────────
 * Vordefinierte Repo-Layout-Profile (default / monorepo / turborepo / custom)
 * für die Anpassung der Renovate-Konfig & Patch-Pfade.
 */

export type RepoProfileId = "default" | "monorepo" | "turborepo" | "custom";

export interface RepoProfile {
  id: RepoProfileId;
  label: string;
  description: string;
  workflowsGlob: string[];
  pinStrategy: "digest" | "version" | "lockfile";
  schedule: string[];
  groupingHint: string;
  extraPackageRules?: Array<Record<string, unknown>>;
}

export const REPO_PROFILES: RepoProfile[] = [
  {
    id: "default",
    label: "Single-Repo (Standard)",
    description: "Ein Repository, ein Lockfile, Workflows in .github/workflows/.",
    workflowsGlob: ["^\\.github/workflows/[^/]+\\.ya?ml$"],
    pinStrategy: "digest",
    schedule: ["before 6am on monday"],
    groupingHint: "github-actions weekly",
  },
  {
    id: "monorepo",
    label: "Monorepo (npm/pnpm workspaces)",
    description: "Mehrere packages/apps mit eigenen Lockfiles. Nightly Schedule statt wöchentlich.",
    workflowsGlob: ["^\\.github/workflows/[^/]+\\.ya?ml$"],
    pinStrategy: "digest",
    schedule: ["after 1am every weekday"],
    groupingHint: "github-actions monorepo daily",
    extraPackageRules: [
      {
        description: "Group all workspace dependencies per package",
        matchManagers: ["npm"],
        groupName: "{{depName}}",
      },
    ],
  },
  {
    id: "turborepo",
    label: "Turborepo / Nx",
    description: "Task-orchestriertes Monorepo. Eigener Schedule + Caching-Tools-Pinning.",
    workflowsGlob: ["^\\.github/workflows/[^/]+\\.ya?ml$"],
    pinStrategy: "digest",
    schedule: ["after 2am on tuesday"],
    groupingHint: "github-actions turbo weekly",
    extraPackageRules: [
      {
        description: "Pin turborepo + nx tooling to exact versions",
        matchPackageNames: ["turbo", "nx", "@nx/*"],
        rangeStrategy: "pin",
      },
    ],
  },
  {
    id: "custom",
    label: "Custom Pfade",
    description: "Eigene Workflow-Pfade angeben (z. B. .gitlab-ci.yml, ci/).",
    workflowsGlob: ["^\\.github/workflows/[^/]+\\.ya?ml$", "^ci/[^/]+\\.ya?ml$"],
    pinStrategy: "digest",
    schedule: ["before 6am on monday"],
    groupingHint: "github-actions weekly",
  },
];

export function buildRenovateConfigForProfile(profile: RepoProfile): string {
  const config = {
    $schema: "https://docs.renovatebot.com/renovate-schema.json",
    extends: [
      "config:recommended",
      profile.pinStrategy === "digest" ? "helpers:pinGitHubActionDigests" : null,
      ":semanticCommits",
      ":dependencyDashboard",
    ].filter(Boolean),
    timezone: "Europe/Berlin",
    schedule: profile.schedule,
    prHourlyLimit: 4,
    prConcurrentLimit: 8,
    vulnerabilityAlerts: { enabled: true, schedule: ["at any time"] },
    "github-actions": { fileMatch: profile.workflowsGlob },
    packageRules: [
      {
        description: "Pin GitHub Actions (P2 unpinned-actions remediation).",
        matchManagers: ["github-actions"],
        pinDigests: profile.pinStrategy === "digest",
        groupName: "github-actions digests",
        labels: ["github-actions", "P2-unpinned"],
      },
      {
        description: "Group minor/patch GH Action upgrades.",
        matchManagers: ["github-actions"],
        matchUpdateTypes: ["minor", "patch", "digest"],
        groupName: profile.groupingHint,
        schedule: profile.schedule,
      },
      ...(profile.extraPackageRules ?? []),
    ],
  };
  return JSON.stringify(config, null, 2);
}

export function buildPatchPathHint(profile: RepoProfile): string {
  if (profile.id === "monorepo") {
    return "💡 Patches in apps/<app>/.github/workflows/ ggf. doppelt anwenden, falls App-spezifische Workflows existieren.";
  }
  if (profile.id === "turborepo") {
    return "💡 turbo.json-Tasks mit eigenen Action-Versionen separat pinnen lassen.";
  }
  if (profile.id === "custom") {
    return "💡 Pfade in renovate.json `github-actions.fileMatch` anpassen.";
  }
  return "Standard-Layout: Patches direkt in .github/workflows/<file>.yml anwenden.";
}
