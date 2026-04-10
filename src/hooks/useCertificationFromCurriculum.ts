import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve a certification_id from a curriculum_id.
 * Returns null while loading or if not found.
 */
export function useCertificationFromCurriculum(curriculumId: string | null | undefined) {
  const [certificationId, setCertificationId] = useState<string | null>(null);

  useEffect(() => {
    if (!curriculumId) { setCertificationId(null); return; }

    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("course_packages")
        .select("certification_id")
        .eq("curriculum_id", curriculumId)
        .not("certification_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (alive && data?.certification_id) {
        setCertificationId(data.certification_id);
      }
    })();
    return () => { alive = false; };
  }, [curriculumId]);

  return certificationId;
}
