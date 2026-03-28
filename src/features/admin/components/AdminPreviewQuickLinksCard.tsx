import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  FileQuestion,
  Brain,
  Mic,
  LayoutDashboard,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getAdminPreviewDeepLinks,
  type AdminPreviewDeepLinks,
} from "@/features/admin/api/adminPreviewDeepLinksApi";

type PreviewMode = "standard" | "premium" | "adaptive";

function withPreview(url: string | null, mode: PreviewMode) {
  if (!url) return null;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}admin_preview=1&preview_mode=${mode}`;
}

export function AdminPreviewQuickLinksCard({
  curriculumId,
  previewMode,
}: {
  curriculumId: string;
  previewMode: PreviewMode;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-preview-deep-links", curriculumId],
    queryFn: () => getAdminPreviewDeepLinks(curriculumId),
    staleTime: 60_000,
  });

  const open = (url: string | null) => {
    const finalUrl = withPreview(url, previewMode);
    if (!finalUrl) return;
    window.open(finalUrl, "_blank");
  };

  if (isLoading) {
    return <div className="rounded-xl border p-3 text-xs text-muted-foreground">Lade Quick Links…</div>;
  }

  if (error || !data) {
    return <div className="rounded-xl border p-3 text-xs text-muted-foreground">Quick Links nicht verfügbar.</div>;
  }

  const items = [
    { label: "Dashboard", icon: LayoutDashboard, url: data.dashboard_url },
    { label: "Kurs", icon: BookOpen, url: data.course_url },
    { label: "Erste Lesson", icon: CheckCircle2, url: data.lesson_url },
    { label: "MiniCheck", icon: CheckCircle2, url: data.minicheck_url },
    { label: "Prüfung", icon: FileQuestion, url: data.exam_url },
    { label: "Adaptive", icon: Sparkles, url: data.adaptive_exam_url },
    { label: "Tutor", icon: Brain, url: data.tutor_url },
    { label: "Oral", icon: Mic, url: data.oral_exam_url },
  ];

  return (
    <div className="rounded-xl border p-3 space-y-3">
      <div className="text-xs font-semibold text-muted-foreground">Quick Test Links</div>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.label}
              variant="ghost"
              size="sm"
              className="justify-start text-xs h-7"
              disabled={!item.url}
              onClick={() => open(item.url)}
            >
              <Icon className="mr-1.5 h-3 w-3" />
              {item.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
