import { describe, it, expect, beforeEach } from \"vitest\";
import { buildHeroPhrasing, heroSeoTitle, classifyQualificationDetailed } from \"../heroPhrasing\";
import {
  __resetUnclassifiableHeroLogger,
  listUnclassifiableHeroEntries,
} from \"../unclassifiableLogger\";

beforeEach(() => __resetUnclassifiableHeroLogger());

interface Case {
  name: string;
  input: Parameters<typeof buildHeroPhrasing>[0];
  expect: {
    kind: string;
    prefix: string;
    highlight: string;
    suffix?: string;
    plain: string;
    examNoun: string;
    examContextPhrase: string;
    chamberExamPhrase: string;
    productHeading: string;
    badgeLabel: string;
    seoTitle: string;
    isUnknown?: boolean;
    /** Substrings that MUST NOT appear in plain/subline/contexts. */
    forbidden?: string[];
  };
}

const CASES: Case[] = [
  {
    name: \"Ausbildung — Bankkaufmann (IHK)\",
    input: { title: \"Bankkaufmann/-frau (IHK)\", catalogType: \"ausbildung\", chamberType: \"IHK\" },
    expect: {
      kind: \"ausbildung\",
      prefix: \"Bestehe deine Abschlussprüfung als\",
      highlight: \"Bankkaufmann/-frau\",
      suffix: \"– systematisch & sicher\",
      plain: \"Bestehe deine Abschlussprüfung als Bankkaufmann/-frau – systematisch & sicher\",
      examNoun: \"Abschlussprüfung\",
      examContextPhrase: \"Abschlussprüfung als Bankkaufmann/-frau\",
      chamberExamPhrase: \"IHK-Abschlussprüfung als Bankkaufmann/-frau\",
      productHeading: \"Prüfungstraining Bankkaufmann/-frau\",
      badgeLabel: \"IHK-Abschlussprüfung\",
      seoTitle: \"Bankkaufmann/-frau Prüfungstraining — Abschlussprüfung sicher bestehen\",
    },
  },
  {
    name: \"Sonstiges/AEVO — Einzelprüfung (kein \\"als\")\",
    input: { title: \"Ausbildereignungsprüfung (AEVO)\", catalogType: \"Sonstiges\", chamberType: \"IHK\" },
    expect: {
      kind: \"einzelpruefung\",
      prefix: \"Bereite dich optimal auf die\",
      highlight: \"Ausbildereignungsprüfung\",
      suffix: \"vor\",
      plain: \"Bereite dich optimal auf die Ausbildereignungsprüfung vor.\",
      examNoun: \"Prüfung\",
      examContextPhrase: \"Ausbildereignungsprüfung\",
      chamberExamPhrase: \"Ausbildereignungsprüfung\",
      productHeading: \"Training: Ausbildereignungsprüfung\",
      badgeLabel: \"Ausbildereignungsprüfung\",
      seoTitle: \"Ausbildereignungsprüfung — gezielt vorbereiten und bestehen\",
      forbidden: [\"als AEVO\", \"als Ausbildereignung\", \"Prüfung als\"],
    },
  },
  {
    name: \"Studium — BWL (kein \\"als\")\",
    input: { title: \"BWL\", catalogType: \"studium\", chamberType: null },
    expect: {
      kind: \"studium\",
      prefix: \"Bereite dich optimal auf deine Prüfungen im Studiengang\",
      highlight: \"BWL\",
      suffix: \"vor\",
      plain: \"Bereite dich optimal auf deine Prüfungen im Studiengang BWL vor.\",
      examNoun: \"Prüfung\",
      examContextPhrase: \"Prüfung im Studiengang BWL\",
      chamberExamPhrase: \"Prüfung im Studiengang BWL\",
      productHeading: \"Prüfungstraining BWL\",
      badgeLabel: \"Hochschulprüfung\",
      seoTitle: \"BWL Klausurvorbereitung — gezielt bestehen\",
      forbidden: [\"als BWL\", \"Prüfung als\"],
    },
  },
  {
    name: \"Meister — Industriemeister Metall\",
    input: { title: \"Industriemeister Metall\", catalogType: \"meister\", chamberType: \"IHK\" },
    expect: {
      kind: \"meister\",
      prefix: \"Bestehe deine Meisterprüfung zum/zur\",
      highlight: \"Industriemeister Metall\",
      suffix: \"– systematisch & sicher\",
      plain: \"Bestehe deine Meisterprüfung zum/zur Industriemeister Metall – systematisch & sicher\",
      examNoun: \"Meisterprüfung\",
      examContextPhrase: \"Meisterprüfung zum/zur Industriemeister Metall\",
      chamberExamPhrase: \"IHK-Meisterprüfung zum/zur Industriemeister Metall\",
      productHeading: \"Prüfungstraining Industriemeister Metall\",
      badgeLabel: \"IHK-Meisterprüfung\",
      seoTitle: \"Industriemeister Metall — Meisterprüfung sicher bestehen\",
    },
  },
  {
    name: \"Fortbildung — Wirtschaftsfachwirt\",
    input: { title: \"Geprüfter Wirtschaftsfachwirt (IHK)\", catalogType: \"fortbildung\", chamberType: \"IHK\" },
    expect: {
      kind: \"fortbildung\",
      prefix: \"Bestehe deine Fortbildungsprüfung zum/zur\",
      highlight: \"Geprüfter Wirtschaftsfachwirt\",
      suffix: \"– systematisch & sicher\",
      plain: \"Bestehe deine Fortbildungsprüfung zum/zur Geprüfter Wirtschaftsfachwirt – systematisch & sicher\",
      examNoun: \"Fortbildungsprüfung\",
      examContextPhrase: \"Fortbildungsprüfung zum/zur Geprüfter Wirtschaftsfachwirt\",
      chamberExamPhrase: \"IHK-Fortbildungsprüfung zum/zur Geprüfter Wirtschaftsfachwirt\",
      productHeading: \"Prüfungstraining Geprüfter Wirtschaftsfachwirt\",
      badgeLabel: \"IHK-Fortbildungsprüfung\",
      seoTitle: \"Geprüfter Wirtschaftsfachwirt — Fortbildungsprüfung sicher bestehen\",
    },
  },
  {
    name: \"Zertifikat — Scrum\",
    input: { title: \"Professional Scrum Master Zertifikat\", catalogType: \"branchenzertifikat\", chamberType: null },
    expect: {
      kind: \"zertifikat\",
      prefix: \"Bereite dich optimal auf die\",
      highlight: \"Professional Scrum Master Zertifikat\",
      suffix: \"vor\",
      plain: \"Bereite dich optimal auf die Professional Scrum Master Zertifikat vor.\",
      examNoun: \"Prüfung\",
      examContextPhrase: \"Prüfung Professional Scrum Master Zertifikat\",
      chamberExamPhrase: \"Prüfung Professional Scrum Master Zertifikat\",
      productHeading: \"Prüfungstraining Professional Scrum Master Zertifikat\",
      badgeLabel: \"Zertifizierungsprüfung\",
      seoTitle: \"Professional Scrum Master Zertifikat — gezielt vorbereiten und bestehen\",
    },
  },
  {
    name: \"Sachkunde — §34a\",
    input: { title: \"Sachkundeprüfung §34a\", catalogType: \"sachkunde\", chamberType: \"IHK\" },
    expect: {
      kind: \"einzelpruefung\",
      prefix: \"Bereite dich optimal auf die\",
      highlight: \"Sachkundeprüfung §34a\",
      suffix: \"vor\",
      plain: \"Bereite dich optimal auf die Sachkundeprüfung §34a vor.\",
      examNoun: \"Prüfung\",
      examContextPhrase: \"Sachkundeprüfung §34a\",
      chamberExamPhrase: \"Sachkundeprüfung §34a\",
      productHeading: \"Training: Sachkundeprüfung §34a\",
      badgeLabel: \"Sachkundeprüfung §34a\",
      seoTitle: \"Sachkundeprüfung §34a — gezielt vorbereiten und bestehen\",
    },
  },
  {
    name: \"Unbekannt — Fallback ohne catalog_type & ohne Treffer\",
    input: { title: \"Mystery Schulung XYZ\", catalogType: null, chamberType: null, recordId: \"rec-001\", slug: \"mystery-xyz\" },
    expect: {
      kind: \"unknown\",
      isUnknown: true,
      prefix: \"Bereite dich gezielt auf\",
      highlight: \"Mystery Schulung XYZ\",
      suffix: \"vor\",
      plain: \"Bereite dich gezielt auf Mystery Schulung XYZ vor.\",
      examNoun: \"Prüfung\",
      examContextPhrase: \"Prüfung Mystery Schulung XYZ\",
      chamberExamPhrase: \"Prüfung Mystery Schulung XYZ\",
      productHeading: \"Prüfungstraining Mystery Schulung XYZ\",
      badgeLabel: \"Prüfungstraining\",
      seoTitle: \"Mystery Schulung XYZ — strukturiert vorbereiten\",
      forbidden: [\"als Mystery\"],
    },
  },
];

describe(\"heroPhrasing — SSOT snapshots per catalog_type\", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const p = buildHeroPhrasing(c.input);
      expect(p.kind).toBe(c.expect.kind);
      expect(p.prefix).toBe(c.expect.prefix);
      expect(p.highlight).toBe(c.expect.highlight);
      if (c.expect.suffix !== undefined) expect(p.suffix).toBe(c.expect.suffix);
      expect(p.plain).toBe(c.expect.plain);
      expect(p.examNoun).toBe(c.expect.examNoun);
      expect(p.examContextPhrase).toBe(c.expect.examContextPhrase);
      expect(p.chamberExamPhrase).toBe(c.expect.chamberExamPhrase);
      expect(p.productHeading).toBe(c.expect.productHeading);
      expect(p.badgeLabel).toBe(c.expect.badgeLabel);
      expect(heroSeoTitle(c.input)).toBe(c.expect.seoTitle);
      if (c.expect.isUnknown !== undefined) expect(p.isUnknown).toBe(c.expect.isUnknown);
      for (const bad of c.expect.forbidden ?? []) {
        expect(p.plain).not.toContain(bad);
        expect(p.subline).not.toContain(bad);
        expect(p.chamberExamPhrase).not.toContain(bad);
        expect(p.productHeading).not.toContain(bad);
      }
    });
  }
});

describe(\"heroPhrasing — Forbidden \\"als\"-patterns global\", () => {
  const FORBIDDEN_GLOBAL = [
    /Pr(ü|ue)fung als AEVO/i,
    /Pr(ü|ue)fung als BWL/i,
    /Abschlusspr(ü|ue)fung als AEVO/i,
    /Abschlusspr(ü|ue)fung als BWL/i,
  ];
  for (const c of CASES) {
    it(`\"${c.name}\" contains no forbidden global pattern`, () => {
      const p = buildHeroPhrasing(c.input);
      const blob = [p.plain, p.subline, p.examContextPhrase, p.chamberExamPhrase, p.productHeading].join(\" || \");
      for (const re of FORBIDDEN_GLOBAL) {
        expect(blob, `pattern ${re} matched in: ${blob}`).not.toMatch(re);
      }
    });
  }
});

describe(\"heroPhrasing — Unclassifiable logger\", () => {
  it(\"logs only unknown/low-confidence records\", () => {
    buildHeroPhrasing({ title: \"Bankkaufmann (IHK)\", catalogType: \"ausbildung\", chamberType: \"IHK\" });
    expect(listUnclassifiableHeroEntries()).toHaveLength(0);

    buildHeroPhrasing({ title: \"Mystery Schulung XYZ\", catalogType: null, chamberType: null, recordId: \"rec-001\" });
    const after = listUnclassifiableHeroEntries();
    expect(after).toHaveLength(1);
    expect(after[0].recordId).toBe(\"rec-001\");
    expect(after[0].isUnknown).toBe(true);
  });

  it(\"dedupes identical records\", () => {
    buildHeroPhrasing({ title: \"Mystery\", catalogType: null, recordId: \"dup-1\" });
    buildHeroPhrasing({ title: \"Mystery\", catalogType: null, recordId: \"dup-1\" });
    expect(listUnclassifiableHeroEntries()).toHaveLength(1);
  });
});

describe(\"classifyQualificationDetailed — confidence\", () => {
  it(\"high confidence when catalog_type is canonical\", () => {
    expect(classifyQualificationDetailed({ title: \"x\", catalogType: \"ausbildung\" }).confidence).toBe(\"high\");
    expect(classifyQualificationDetailed({ title: \"x\", catalogType: \"meister\" }).confidence).toBe(\"high\");
  });
  it(\"medium for heuristic\", () => {
    expect(classifyQualificationDetailed({ title: \"Bankkaufmann\", catalogType: null }).confidence).toBe(\"medium\");
  });
  it(\"low+unknown for totally opaque input\", () => {
    const r = classifyQualificationDetailed({ title: \"Mystery XYZ\", catalogType: null });
    expect(r.confidence).toBe(\"low\");
    expect(r.isUnknown).toBe(true);
  });
});
