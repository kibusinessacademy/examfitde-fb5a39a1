import { describe, it, expect } from "vitest";
import {
  buildHeroPhrasing,
  classifyQualification,
  stripChamberSuffix,
} from "../heroPhrasing";

describe("heroPhrasing SSOT", () => {
  it("classifies AEVO as Einzelprüfung (nicht Beruf)", () => {
    expect(
      classifyQualification({
        title: "Ausbildereignungsprüfung (AEVO)",
        catalogType: "Sonstiges",
      }),
    ).toBe("einzelpruefung");
  });

  it("classifies Bankkaufmann/-frau als Ausbildungsberuf", () => {
    expect(
      classifyQualification({
        title: "Bankkaufmann/-frau (IHK)",
        catalogType: "Ausbildung",
      }),
    ).toBe("ausbildung");
  });

  it("classifies Wirtschaftsfachwirt als Fortbildung", () => {
    expect(
      classifyQualification({
        title: "Wirtschaftsfachwirt (IHK)",
        catalogType: "Fortbildung_IHK",
      }),
    ).toBe("fortbildung");
  });

  it("classifies Industriemeister als Meister", () => {
    expect(
      classifyQualification({
        title: "Industriemeister Metall (IHK)",
        catalogType: "Meister",
      }),
    ).toBe("meister");
  });

  it("classifies BWL (Studium) korrekt — keine 'Prüfung als BWL'", () => {
    const p = buildHeroPhrasing({ title: "BWL", catalogType: "Studium" });
    expect(p.kind).toBe("studium");
    expect(p.plain).not.toMatch(/Prüfung als BWL/i);
    expect(p.plain).toMatch(/Studiengang BWL/);
  });

  it("AEVO erzeugt KEIN 'Abschlussprüfung als AEVO'", () => {
    const p = buildHeroPhrasing({
      title: "Ausbildereignungsprüfung (AEVO)",
      catalogType: "Sonstiges",
    });
    expect(p.plain).not.toMatch(/als Ausbildereignung/i);
    expect(p.plain).not.toMatch(/als AEVO/i);
    expect(p.plain).toMatch(/Bereite dich optimal auf die Ausbildereignungsprüfung/);
  });

  it("Ausbildung erzeugt korrektes 'als Bankkaufmann/-frau'", () => {
    const p = buildHeroPhrasing({
      title: "Bankkaufmann/-frau (IHK)",
      catalogType: "Ausbildung",
      chamberType: "IHK",
    });
    expect(p.plain).toMatch(/Bestehe deine Abschlussprüfung als Bankkaufmann\/-frau/);
    expect(p.highlight).toBe("Bankkaufmann/-frau");
  });

  it("stripChamberSuffix entfernt nur Kammer-Kürzel", () => {
    expect(stripChamberSuffix("Bankkaufmann/-frau (IHK)")).toBe("Bankkaufmann/-frau");
    expect(stripChamberSuffix("Kfz-Meister (HWK)")).toBe("Kfz-Meister");
    expect(stripChamberSuffix("AWS Solutions Architect")).toBe("AWS Solutions Architect");
  });
});
