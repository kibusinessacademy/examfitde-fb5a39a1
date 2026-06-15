/**
 * PR-3: Visual badges for translation state.
 * - "Übersetzung folgt" when pending/queued
 * - "Original (DE)" when fallback served
 * - "Aktualisierung läuft" when stale
 */
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import type { ResolvedText } from "@/hooks/i18n/useTranslatedContent";

interface Props {
  state: Pick<ResolvedText, "isFallback" | "isPending" | "isStale" | "language">;
  className?: string;
}

export function TranslationBadge({ state, className }: Props) {
  const { t, i18n } = useTranslation();
  const targetLang = (i18n.language || "de").slice(0, 2);

  // Nothing to show when target == served and fresh
  if (!state.isFallback && !state.isPending && !state.isStale) return null;
  if (targetLang === "de" && !state.isStale) return null;

  if (state.isPending) {
    return (
      <Badge variant="secondary" className={className}>
        {t("i18n.badge.pending", "Übersetzung folgt")}
      </Badge>
    );
  }
  if (state.isFallback) {
    return (
      <Badge variant="outline" className={className}>
        {t("i18n.badge.fallback", "Original (DE)")}
      </Badge>
    );
  }
  if (state.isStale) {
    return (
      <Badge variant="outline" className={className}>
        {t("i18n.badge.stale", "Aktualisierung läuft")}
      </Badge>
    );
  }
  return null;
}
