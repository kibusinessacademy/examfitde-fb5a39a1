// Global language switcher — header-level. Persists choice to localStorage and (if logged in) profiles.preferred_language.
import { Globe, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface LanguageSwitcherProps {
  variant?: "ghost" | "outline";
  className?: string;
  compact?: boolean;
}

export function LanguageSwitcher({ variant = "ghost", className, compact = false }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const active = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0];

  const handleChange = async (code: string) => {
    if (code === i18n.language) return;
    await i18n.changeLanguage(code);
    try {
      localStorage.setItem("berufos.lang", code);
    } catch {
      /* ignore */
    }
    if (user) {
      // Best-effort: persist to profile. Ignore failures (column may be missing in older envs).
      void supabase
        .from("profiles")
        .update({ preferred_language: code } as never)
        .eq("id", user.id)
        .then(() => undefined, () => undefined);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          className={className}
          aria-label={t("language.switch")}
          data-testid="language-switcher"
        >
          <Globe className="h-4 w-4" />
          <span className={compact ? "sr-only" : "ml-2 text-sm font-medium"}>
            {active.code.toUpperCase()}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SUPPORTED_LANGUAGES.map((lang) => {
          const isActive = lang.code === i18n.language;
          return (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => void handleChange(lang.code)}
              className="cursor-pointer"
              data-testid={`language-option-${lang.code}`}
            >
              <span className="mr-2" aria-hidden="true">{lang.flag}</span>
              <span className="flex-1">{lang.native}</span>
              {isActive && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LanguageSwitcher;
