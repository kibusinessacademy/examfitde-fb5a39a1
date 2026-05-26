/**
 * Premium UX — Setup Wizards client API.
 * Wraps the two SSOT RPCs: list + upsert.
 */
import { supabase } from '@/integrations/supabase/client';

export type SetupWizardStatus =
  | 'not_started' | 'in_progress' | 'connected' | 'error' | 'skipped';

export interface SetupWizardState {
  wizard_key: string;
  status: SetupWizardStatus;
  current_step: number;
  total_steps: number;
  config: Record<string, unknown>;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at?: string;
}

export interface SetupWizardListResponse {
  reason: 'OK' | 'NOT_AUTHORIZED';
  org_id: string;
  states: SetupWizardState[];
  generated_at?: string;
}

export interface SetupWizardUpsertResponse {
  reason: 'OK' | 'NOT_AUTHORIZED' | 'INVALID_WIZARD_KEY';
  state?: SetupWizardState;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc as any;

export async function listSetupWizards(orgId: string): Promise<SetupWizardListResponse> {
  const { data, error } = await rpc('setup_wizard_list_for_org', { _org_id: orgId });
  if (error) throw new Error(error.message);
  return data as SetupWizardListResponse;
}

export async function upsertSetupWizard(args: {
  orgId: string;
  wizardKey: string;
  status: SetupWizardStatus;
  currentStep: number;
  totalSteps: number;
  config?: Record<string, unknown>;
  lastError?: string | null;
}): Promise<SetupWizardUpsertResponse> {
  const { data, error } = await rpc('setup_wizard_upsert_state', {
    _org_id: args.orgId,
    _wizard_key: args.wizardKey,
    _status: args.status,
    _current_step: args.currentStep,
    _total_steps: args.totalSteps,
    _config: args.config ?? {},
    _last_error: args.lastError ?? null,
  });
  if (error) throw new Error(error.message);
  return data as SetupWizardUpsertResponse;
}
