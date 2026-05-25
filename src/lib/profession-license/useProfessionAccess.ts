import { useQuery } from "@tanstack/react-query";
import { getOrgProfessionAccess, OrgProfessionAccess } from "./api";

export function useProfessionAccess(organizationId: string | null | undefined) {
  return useQuery<OrgProfessionAccess>({
    queryKey: ["profession-access", organizationId],
    queryFn: () => getOrgProfessionAccess(organizationId!),
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}

export function useAgentEnabled(access: OrgProfessionAccess | undefined, agentSlug: string) {
  if (!access) return { enabled: false, reason: "loading" as const };
  const row = access.agents.find((a) => a.slug === agentSlug);
  if (!row) return { enabled: false, reason: "unknown_agent" as const };
  if (!row.enabled) return { enabled: false, reason: "disabled" as const };
  const hasPrimary = access.licenses.some((l) => l.is_primary && l.status === "active");
  if (!hasPrimary) return { enabled: false, reason: "no_primary_license" as const };
  return { enabled: true, reason: null as null };
}
