import { useSearchParams } from "react-router-dom";

export function AdminPreviewBanner() {
  const [params] = useSearchParams();
  const isPreview = params.get("admin_preview") === "1";

  if (!isPreview) return null;

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
      Admin Preview aktiv — du testest diesen Kurs im Learner-Modus.
    </div>
  );
}
