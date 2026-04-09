import { useState } from 'react';
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bulk-import-jobs'] }),
  });
}
