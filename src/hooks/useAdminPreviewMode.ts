import { useSearchParams } from "react-router-dom";

export function useAdminPreviewMode() {
  const [params] = useSearchParams();

  const isAdminPreview = params.get("admin_preview") === "1";
  const previewMode =
    (params.get("preview_mode") as "standard" | "premium" | "adaptive" | null) ??
    "standard";

  return {
    isAdminPreview,
    previewMode,
    isPremiumPreview: isAdminPreview && previewMode === "premium",
    isAdaptivePreview: isAdminPreview && previewMode === "adaptive",
  };
}
