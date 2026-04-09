export interface BulkImportJob {
  id: string;
  user_id: string;
  status: 'pending' | 'validating' | 'validated' | 'dry_run' | 'executing' | 'completed' | 'failed';
  file_name: string | null;
  file_type: string;
  total_rows: number;
  valid_count: number;
  error_count: number;
  warning_count: number;
  created_count: number;
  updated_count: number;
  failed_count: number;
  validation_result: ValidationResult | null;
  dry_run_result: DryRunResult | null;
  execution_result: ExecutionResult | null;
  created_at: string;
  completed_at: string | null;
}

export interface ValidationResult {
  valid_count: number;
  total_rows: number;
  error_count: number;
  warning_count: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationIssue {
  row: number;
  field: string;
  message: string;
}

export interface DryRunResult {
  to_create: number;
  to_update: number;
  preview: DryRunPreviewRow[];
}

export interface DryRunPreviewRow {
  email: string;
  external_id: string;
  action: 'create' | 'update';
  existing_identity_id?: string;
}

export interface ExecutionResult {
  created: number;
  updated: number;
  failed: number;
  errors: { email: string; error: string }[];
}

export interface LtiRegistration {
  id: string;
  issuer: string;
  client_id: string;
  auth_login_url: string;
  keyset_url: string;
  status: string;
  created_at: string;
}

export interface ScimToken {
  id: string;
  label: string;
  org_id: string | null;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

export type IntegrationStatus = 'connected' | 'not_configured' | 'error';
