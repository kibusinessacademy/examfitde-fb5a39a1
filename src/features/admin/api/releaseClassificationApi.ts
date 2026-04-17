import { supabase } from "@/integrations/supabase/client";

export type ReleaseClass = "release_ok" | "release_block" | "release_warn";

export interface ReleaseClassification {
  package_id: string;
  package_status: string;
  release_class: ReleaseClass;
  deficiency_codes: string[] | null;
  approved_questions: number;
  total_learning_fields: number;
  covered_learning_fields: number;
  course_title: string | null;
}

export async function getReleaseClassifications(packageIds: string[]) {
  if (packageIds.length === 0) return [] as ReleaseClassification[];
  const { data, error } = await supabase
    .from("v_package_release_classification" as any)
    .select(
      "package_id, package_status, release_class, deficiency_codes, approved_questions, total_learning_fields, covered_learning_fields, course_title",
    )
    .in("package_id", packageIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReleaseClassification[];
}
