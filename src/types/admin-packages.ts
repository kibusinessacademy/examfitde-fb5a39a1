export type AdminVisibleCoursePackage = {
  package_id: string;
  id: string;
  course_id: string | null;
  curriculum_id: string | null;
  status: string;
  build_progress: number;
  integrity_passed: boolean;
  council_approved: boolean;
  council_approved_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  components: Record<string, boolean>;
  created_by: string | null;
  priority: number | null;
  beruf_id: string | null;
  canonical_title: string;
  title: string; // backward compat alias = canonical_title
  canonical_title_norm: string;
  raw_course_title: string | null;
  raw_curriculum_title: string | null;
  beruf_display_name: string | null;
};
