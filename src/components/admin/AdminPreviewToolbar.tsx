import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function AdminPreviewToolbar({
  curriculumId,
}: {
  curriculumId?: string | null;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const isPreview = params.get("admin_preview") === "1";
  const previewMode = params.get("preview_mode") ?? "standard";

  if (!isPreview || !curriculumId) return null;

  const go = (path: string) => {
    navigate(`${path}?admin_preview=1&preview_mode=${previewMode}`);
  };

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => go(`/learner/dashboard/${curriculumId}`)}>
        Dashboard
      </Button>
      <Button size="sm" variant="outline" onClick={() => go(`/learner/course/${curriculumId}`)}>
        Kurs
      </Button>
      <Button size="sm" variant="outline" onClick={() => go(`/learner/exam/${curriculumId}`)}>
        Prüfung
      </Button>
      <Button size="sm" variant="outline" onClick={() => go(`/learner/exam/adaptive/${curriculumId}`)}>
        Adaptive
      </Button>
      <Button size="sm" variant="outline" onClick={() => go(`/learner/tutor/${curriculumId}`)}>
        Tutor
      </Button>
      <Button size="sm" variant="outline" onClick={() => go(`/learner/oral-exam/${curriculumId}`)}>
        Oral
      </Button>
    </div>
  );
}
