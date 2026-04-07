import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Share2, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SITE_URL = "https://examfitde.lovable.app";

interface HumorShareButtonsProps {
  humorId: string;
  humorText: string;
}

type Platform = "linkedin" | "facebook" | "x" | "whatsapp" | "pinterest" | "native" | "copy";

const PLATFORMS: { key: Platform; label: string; icon: string }[] = [
  { key: "whatsapp", label: "WhatsApp", icon: "💬" },
  { key: "linkedin", label: "LinkedIn", icon: "💼" },
  { key: "x", label: "X", icon: "𝕏" },
  { key: "facebook", label: "Facebook", icon: "📘" },
  { key: "copy", label: "Kopieren", icon: "📋" },
];

function buildShareUrl(platform: Platform, humorId: string, text: string): string | null {
  const pageUrl = `${SITE_URL}/witz/${humorId}?utm_source=${platform}&utm_medium=social&utm_campaign=witz-des-tages`;
  const shareText = `😂 ${text}\n\nMehr Prüfungshumor auf ExamFit:`;

  switch (platform) {
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}&quote=${encodeURIComponent(shareText)}`;
    case "x":
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}`;
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(`${shareText} ${pageUrl}`)}`;
    case "pinterest":
      return `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(pageUrl)}&description=${encodeURIComponent(shareText)}`;
    default:
      return null;
  }
}

export function HumorShareButtons({ humorId, humorText }: HumorShareButtonsProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const trackShare = async (platform: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("humor_shares" as any).insert({
          humor_id: humorId,
          user_id: user.id,
          platform,
        });
      }
    } catch {
      // non-blocking
    }
  };

  const handleShare = async (platform: Platform) => {
    if (platform === "native" && navigator.share) {
      try {
        await navigator.share({
          title: "Witz des Tages – ExamFit",
          text: `😂 ${humorText}`,
          url: `${SITE_URL}/witz/${humorId}?utm_source=native&utm_medium=social&utm_campaign=witz-des-tages`,
        });
        await trackShare("native");
      } catch {
        // user cancelled
      }
      return;
    }

    if (platform === "copy") {
      const url = `${SITE_URL}/witz/${humorId}?utm_source=copy&utm_medium=social&utm_campaign=witz-des-tages`;
      await navigator.clipboard.writeText(`😂 ${humorText}\n\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Link kopiert!" });
      await trackShare("copy");
      return;
    }

    const url = buildShareUrl(platform, humorId, humorText);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer,width=600,height=500");
      await trackShare(platform);
    }
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={() => {
          if (navigator.share) {
            handleShare("native");
          } else {
            setOpen(true);
          }
        }}
      >
        <Share2 className="h-3.5 w-3.5 mr-1" />
        <span className="text-xs">Teilen</span>
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {PLATFORMS.map(({ key, label, icon }) => (
        <Button
          key={key}
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => handleShare(key)}
          title={label}
        >
          {key === "copy" && copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <span className="text-xs">{icon}</span>
          )}
        </Button>
      ))}
      <Button variant="ghost" size="sm" className="h-7 px-1 text-xs text-muted-foreground" onClick={() => setOpen(false)}>
        ✕
      </Button>
    </div>
  );
}
