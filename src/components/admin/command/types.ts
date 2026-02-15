export interface PackageInfo {
  id: string;
  title: string | null;
  status: string;
  build_progress: number;
  priority: number;
  current_step: string | null;
  step_status_json: Record<string, string> | null;
  created_at: string;
  updated_at: string;
  track: string | null;
}

export interface PlatformKPIs {
  seoPages: number;
  ticketsOpen: number;
  ticketsTotal: number;
  usersTotal: number;
  ordersPaid: number;
  revenueCents: number;
}

export interface QueueHealth {
  pending: number;
  processing: number;
  failed: number;
  stuck: number;
}

export interface BudgetInfo {
  dailyCost: number;
  monthBudget: number;
  monthSpent: number;
}

export interface AIDiagnose {
  risks: { scope_id: string; score: number; risk_type: string }[];
  recommendations: { title: string; impact: string; council_id: string }[];
  systemHealth: { failedJobs: number; pendingJobs: number; gatePassRate: number; aiCostMtd: number; budgetPct: number } | null;
}

export const STEP_LABELS: Record<string, string> = {
  scaffold_learning_course: 'Lernkurs',
  auto_seed_exam_blueprints: 'Blueprints',
  generate_exam_pool: 'Fragenpool',
  generate_oral_exam: 'Mündliche',
  build_ai_tutor_index: 'KI-Tutor',
  generate_handbook: 'Handbuch',
  run_integrity_check: 'Integrität',
  quality_council: 'QA Council',
  auto_publish: 'Publish',
};

export const STEP_ORDER = [
  'scaffold_learning_course', 'auto_seed_exam_blueprints', 'generate_exam_pool',
  'generate_oral_exam', 'build_ai_tutor_index', 'generate_handbook',
  'run_integrity_check', 'quality_council', 'auto_publish',
];
