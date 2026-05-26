import { Link } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import type { ProductCTA, Persona } from "@/lib/products/product-registry";

const ALLOWED_PERSONAS: Persona[] = [
  "default",
  "unternehmer",
  "hr",
  "ausbildung",
  "selbststaendig",
  "institution",
];

function isPersona(value: string | null): value is Persona {
  return !!value && (ALLOWED_PERSONAS as string[]).includes(value);
}

interface PersonaCTAProps {
  cta: ProductCTA;
  size?: "default" | "lg";
  variant?: "default" | "outline";
  className?: string;
}

/**
 * Persona-adaptive CTA.
 * Quelle: ?persona=<key> in URL → fallback default.
 * Externer Link (http*) öffnet als <a>, sonst React-Router-Link.
 */
export function PersonaCTA({ cta, size = "lg", variant = "default", className }: PersonaCTAProps) {
  const [params] = useSearchParams();
  const personaParam = params.get("persona");
  const persona: Persona = isPersona(personaParam) ? personaParam : "default";

  const resolved = cta[persona] ?? cta.default;
  const isExternal = /^https?:\/\//.test(resolved.href);

  const inner = (
    <Button size={size} variant={variant} className={className}>
      {resolved.label}
      <ArrowRight className="ml-2 h-4 w-4" />
    </Button>
  );

  if (isExternal) {
    return (
      <a href={resolved.href} rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return <Link to={resolved.href}>{inner}</Link>;
}
