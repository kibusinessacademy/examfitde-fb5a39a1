import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listSetupWizards,
  upsertSetupWizard,
  type SetupWizardStatus,
} from '@/lib/setup-wizards/api';

export function useSetupWizardList(orgId: string | undefined) {
  return useQuery({
    queryKey: ['setup-wizards', orgId],
    queryFn: () => listSetupWizards(orgId as string),
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

export function useUpsertSetupWizard(orgId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      wizardKey: string;
      status: SetupWizardStatus;
      currentStep: number;
      totalSteps: number;
      config?: Record<string, unknown>;
      lastError?: string | null;
    }) => upsertSetupWizard({ orgId: orgId as string, ...vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setup-wizards', orgId] }),
  });
}
