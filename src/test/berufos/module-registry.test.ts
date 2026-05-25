import { describe, it, expect } from "vitest";
import {
  BERUFOS_MODULES,
  BERUFOS_MODULE_SLUGS,
  getModule,
  modulesForPersona,
} from "@/lib/berufos/modules";
import { BERUFOS } from "@/lib/berufos/brand";

describe("BerufOS Module Registry", () => {
  it("hat genau 10 Module", () => {
    expect(BERUFOS_MODULES).toHaveLength(10);
  });

  it("alle Slugs sind unique und URL-safe", () => {
    const slugs = BERUFOS_MODULE_SLUGS;
    expect(new Set(slugs).size).toBe(slugs.length);
    slugs.forEach((s) => expect(s).toMatch(/^[a-z][a-z0-9-]*$/));
  });

  it("jedes Modul hat tagline, promise und mindestens 3 features", () => {
    for (const m of BERUFOS_MODULES) {
      expect(m.tagline.length).toBeGreaterThan(10);
      expect(m.promise.length).toBeGreaterThan(20);
      expect(m.features.length).toBeGreaterThanOrEqual(3);
      expect(m.personas.length).toBeGreaterThan(0);
    }
  });

  it("live-Module haben href (Deep-Link)", () => {
    BERUFOS_MODULES.filter((m) => m.status === "live").forEach((m) => {
      expect(m.href).toBeTruthy();
    });
  });

  it("planned-Module haben KEINEN href (Waitlist-Pfad)", () => {
    BERUFOS_MODULES.filter((m) => m.status === "planned").forEach((m) => {
      expect(m.href).toBeUndefined();
    });
  });

  it("getModule resolved bekannte Slugs und gibt undefined für unbekannte", () => {
    expect(getModule("learning")).toBeDefined();
    expect(getModule("does-not-exist")).toBeUndefined();
  });

  it("Persona-Filter funktioniert (azubi sieht ExamFit + SkillGraph + Career)", () => {
    const azubi = modulesForPersona("azubi").map((m) => m.slug);
    expect(azubi).toContain("learning");
    expect(azubi).toContain("skills");
    expect(azubi).toContain("career");
  });

  it("Persona null gibt alle Module zurück", () => {
    expect(modulesForPersona(null)).toHaveLength(10);
  });

  it("Brand-SSOT exportiert Masterbrand-Konstanten", () => {
    expect(BERUFOS.name).toBe("BerufOS");
    expect(BERUFOS.hubPath).toBe("/berufos");
    expect(BERUFOS.subBrands.examfit.name).toBe("ExamFit");
    expect(BERUFOS.subBrands.berufsKi.name).toBe("Berufs-KI");
  });
});
