/**
 * renovateRecommendation
 * ──────────────────────
 * Liefert für P2 "unpinned actions" Findings eine direkt copy-pasteable
 * Renovate-Konfig sowie einen vorbereiteten Workflow-Patch-Text (vorher/
 * nachher) für SHA-Pinning.
 */

export const RENOVATE_RECOMMENDED_CONFIG = `{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    "helpers:pinGitHubActionDigests",
    ":semanticCommits",
    ":dependencyDashboard"
  ],
  "timezone": "Europe/Berlin",
  "schedule": ["before 6am on monday"],
  "prHourlyLimit": 4,
  "prConcurrentLimit": 8,
  "vulnerabilityAlerts": { "enabled": true, "schedule": ["at any time"] },
  "packageRules": [
    {
      "matchManagers": ["github-actions"],
      "pinDigests": true,
      "groupName": "github-actions digests",
      "labels": ["github-actions", "P2-unpinned"]
    },
    {
      "matchManagers": ["github-actions"],
      "matchUpdateTypes": ["minor", "patch", "digest"],
      "groupName": "github-actions weekly"
    }
  ]
}`;

/** Bekannte aktuelle SHAs für die meistgenutzten Actions im Repo (Stand 2026-04). */
const KNOWN_SHAS: Record<string, { sha: string; version: string }> = {
  "actions/checkout@v4": { sha: "11bd71901bbe5b1630ceea73d27597364c9af683", version: "v4.2.2" },
  "actions/setup-node@v4": { sha: "1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a", version: "v4.2.0" },
  "actions/upload-artifact@v4": { sha: "65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08", version: "v4.6.0" },
  "actions/download-artifact@v4": { sha: "fa0a91b85d4f404e444e00e005971372dc801d16", version: "v4.1.8" },
  "actions/github-script@v7": { sha: "60a0d83039c74a4aee543508d2ffcb1c3799cdea", version: "v7.0.1" },
  "denoland/setup-deno@v1": { sha: "f4ddc3e6e6f6cab33e3fa3b81fc7a83ada3f7b39", version: "v1.5.0" },
  "peter-evans/create-pull-request@v6": { sha: "67ccf781d68cd99b580ae25a5c18a1cc84ffff1f", version: "v6.1.0" },
  "treosh/lighthouse-ci-action@v12": { sha: "1b0e8eaecb24c14ad17c25fbcf6c40f4b8a2a8d6", version: "v12.1.0" },
};

export interface PatchHunk {
  before: string;
  after: string;
  comment: string;
}

export function buildPatchForUnpinnedAction(useStatement: string): PatchHunk | null {
  const trimmed = useStatement.trim().replace(/^[-\s]*uses:\s*/, "");
  const known = KNOWN_SHAS[trimmed];
  if (!known) {
    return {
      before: `uses: ${trimmed}`,
      after: `uses: ${trimmed}  # TODO: durch Renovate auf SHA pinnen lassen`,
      comment:
        "Action nicht im Known-SHA-Index. Renovate wird beim ersten Lauf eine PR mit dem aktuellen Digest erzeugen.",
    };
  }
  const [repo] = trimmed.split("@");
  return {
    before: `uses: ${trimmed}`,
    after: `uses: ${repo}@${known.sha}  # ${known.version}`,
    comment: `Pin auf vollen SHA von ${known.version}. Renovate Group "github-actions weekly" hält das aktuell.`,
  };
}

export function renovateOnboardingChecklist(): string[] {
  return [
    "1. `renovate.json` im Repo-Root committen (siehe Empfehlung).",
    "2. Renovate App im Repo aktivieren (https://github.com/apps/renovate).",
    "3. Auf den initialen Onboarding-PR warten — Renovate listet alle pinnbaren Actions.",
    "4. Onboarding-PR mergen → ab da kontrollierte wöchentliche Pin-/Upgrade-PRs.",
    "5. Vulnerability-Alerts laufen sofort ohne Schedule.",
  ];
}
