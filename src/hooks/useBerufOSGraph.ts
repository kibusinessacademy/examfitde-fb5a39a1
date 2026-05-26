import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getBerufOSGraphSummary,
  getBerufOSGraphDriftReport,
  rebuildBerufOSGraph,
  activateProposedEdge,
  rejectProposedEdge,
} from '@/lib/berufs-ki/graph';

export function useBerufOSGraphSummary() {
  return useQuery({
    queryKey: ['berufos-graph', 'summary'],
    queryFn: getBerufOSGraphSummary,
    staleTime: 30_000,
  });
}

export function useBerufOSGraphDrift() {
  return useQuery({
    queryKey: ['berufos-graph', 'drift'],
    queryFn: getBerufOSGraphDriftReport,
    staleTime: 30_000,
  });
}

export function useBerufOSGraphRebuild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { scope?: string; dryRun: boolean }) =>
      rebuildBerufOSGraph(vars.scope ?? 'global', vars.dryRun),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['berufos-graph'] });
    },
  });
}

export function useActivateProposedEdge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { edgeId: string; reason?: string }) =>
      activateProposedEdge(vars.edgeId, vars.reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['berufos-graph'] }),
  });
}

export function useRejectProposedEdge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { edgeId: string; reason?: string }) =>
      rejectProposedEdge(vars.edgeId, vars.reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['berufos-graph'] }),
  });
}
