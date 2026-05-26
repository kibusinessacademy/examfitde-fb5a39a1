import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchOrgStructure,
  upsertSite,
  upsertCohort,
  assignMember,
  type OrgStructure,
  type ScopedRole,
} from "@/lib/berufs-ki/orgStructure";

export function useOrgStructure(orgId: string | null | undefined) {
  return useQuery<OrgStructure | null>({
    queryKey: ["org-structure", orgId],
    queryFn: () => (orgId ? fetchOrgStructure(orgId) : Promise.resolve(null)),
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

export function useUpsertSite(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { siteKey: string; name: string; city?: string; region?: string }) =>
      upsertSite({ orgId: orgId ?? "", ...vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-structure", orgId] }),
  });
}

export function useUpsertCohort(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      cohortKey: string;
      name: string;
      professionKey?: string;
      startYear?: number;
      examWindow?: string;
      trainingYear?: number;
      siteId?: string | null;
      departmentId?: string | null;
    }) => upsertCohort({ orgId: orgId ?? "", ...vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-structure", orgId] }),
  });
}

export function useAssignMember(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      userId: string;
      scopedRole: ScopedRole;
      siteId?: string | null;
      departmentId?: string | null;
      cohortId?: string | null;
      reportingUnitId?: string | null;
      isPrimary?: boolean;
    }) => assignMember({ orgId: orgId ?? "", ...vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-structure", orgId] }),
  });
}
