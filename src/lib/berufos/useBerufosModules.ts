/**
 * BerufOS Persona-Filter Hook.
 * Reine UI-Logik — keine Backend-Calls. Persona kommt aus dem URL-Param oder
 * lokalem State im Hub. Spätere Integration mit useOsBeruf() optional.
 */
import { useMemo } from "react";
import {
  BERUFOS_MODULES,
  modulesForPersona,
  type BerufosModule,
  type BerufosPersona,
} from "./modules";

export function useBerufosModules(persona?: BerufosPersona | null): readonly BerufosModule[] {
  return useMemo(() => modulesForPersona(persona), [persona]);
}

export const BERUFOS_PERSONA_LABELS: Record<BerufosPersona | "all", string> = {
  all: "Alle",
  azubi: "Azubi",
  fachkraft: "Fachkraft",
  betrieb: "Betrieb",
  institution: "Institution",
  recruiter: "Recruiter",
};

export const BERUFOS_PERSONA_ORDER: (BerufosPersona | "all")[] = [
  "all",
  "azubi",
  "fachkraft",
  "betrieb",
  "institution",
  "recruiter",
];

export function isBerufosPersona(v: string): v is BerufosPersona {
  return ["azubi", "fachkraft", "betrieb", "institution", "recruiter"].includes(v);
}

export { BERUFOS_MODULES };
