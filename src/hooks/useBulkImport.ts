
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BulkImportJob, ValidationResult, DryRunResult, ExecutionResult } from '@/types/enterprise';

export function useBulkImportJobs() {
  return useQuery({
    queryKey: ['bulk-import-jobs'],
    queryFn: async (): Promise<BulkImportJob[]> => {
      const { data, error } = await supabase
        .from('bulk_import_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as BulkImportJob[];
    },
  });
}

/**
 * Live job progress including rejected_count / rejected_rows.
 * Polls while the job is still running so the UI reflects row-level
 * tolerant counters (created/updated/rejected/failed) consistently.
 */
export function useBulkImportJob(jobId: string | null | undefined) {
  return useQuery({
    queryKey: ['bulk-import-job', jobId],
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data as BulkImportJob | undefined;
      if (!job) return 1500;
      const terminal = ['completed', 'failed'].includes(job.status);
      return terminal ? false : 1500;
    },
    queryFn: async (): Promise<BulkImportJob | null> => {
      if (!jobId) return null;
      const { data, error } = await supabase
        .from('bulk_import_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as BulkImportJob | null;
    },
  });
}


export function useCreateBulkImportJob() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: { fileName: string; rawData: Record<string, string>[] }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('bulk_import_jobs')
        .insert({
          user_id: userData.user.id,
          file_name: params.fileName,
          raw_data: params.rawData as any,
          total_rows: params.rawData.length,
        })
        .select('id')
        .single();

      if (error) throw error;
      return data!.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bulk-import-jobs'] }),
  });
}

export function useValidateBulkImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string): Promise<ValidationResult> => {
      const { data, error } = await supabase.rpc('fn_validate_bulk_import', { p_job_id: jobId });
      if (error) throw error;
      return data as unknown as ValidationResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bulk-import-jobs'] }),
  });
}

export function useDryRunBulkImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string): Promise<DryRunResult> => {
      const { data, error } = await supabase.rpc('fn_dry_run_bulk_import', { p_job_id: jobId });
      if (error) throw error;
      return data as unknown as DryRunResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bulk-import-jobs'] }),
  });
}

export function useExecuteBulkImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string): Promise<ExecutionResult> => {
      const { data, error } = await supabase.rpc('fn_execute_bulk_import', { p_job_id: jobId });
      if (error) throw error;
      return data as unknown as ExecutionResult;
    },
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: ['bulk-import-jobs'] });
      qc.invalidateQueries({ queryKey: ['bulk-import-job', jobId] });
    },
  });
}

