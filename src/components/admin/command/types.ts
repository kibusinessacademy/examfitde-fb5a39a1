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

export const PACKAGE_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: 'Entwurf', color: 'bg-muted text-muted-foreground' },
  queued: { label: 'Warteschlange', color: 'bg-blue-500/10 text-blue-600' },
  building: { label: 'Wird gebaut', color: 'bg-primary/10 text-primary' },
  quality_gate_failed: { label: 'QA blockiert', color: 'bg-destructive/10 text-destructive' },
  frozen: { label: 'Eingefroren', color: 'bg-yellow-500/10 text-yellow-700' },
  failed: { label: 'Fehlgeschlagen', color: 'bg-destructive/10 text-destructive' },
  done: { label: 'Fertig', color: 'bg-emerald-500/10 text-emerald-600' },
  published: { label: 'Veröffentlicht', color: 'bg-emerald-500/10 text-emerald-600' },
};

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
  scaffold_learning_course: 'Scaffold',
  generate_learning_content: 'Lerninhalte',
  validate_learning_content: 'QG Lernen',
  auto_seed_exam_blueprints: 'Blueprints',
  validate_blueprints: 'QG Blueprints',
  generate_exam_pool: 'Fragenpool',
  validate_exam_pool: 'QG Fragen',
  generate_oral_exam: 'Mündliche',
  validate_oral_exam: 'QG Mündl.',
  build_ai_tutor_index: 'KI-Tutor',
  validate_tutor_index: 'QG Tutor',
  generate_handbook: 'Handbuch',
  validate_handbook: 'QG Handbuch',
  run_integrity_check: 'Integrität',
  quality_council: 'QA Council',
  auto_publish: 'Publish',
};

export const STEP_ORDER = [
  'scaffold_learning_course', 'generate_learning_content', 'validate_learning_content',
  'auto_seed_exam_blueprints', 'validate_blueprints',
  'generate_exam_pool', 'validate_exam_pool',
  'build_ai_tutor_index', 'validate_tutor_index',
  'generate_oral_exam', 'validate_oral_exam',
  'generate_handbook', 'validate_handbook',
  'run_integrity_check', 'quality_council', 'auto_publish',
];
