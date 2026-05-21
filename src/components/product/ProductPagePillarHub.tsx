/**
 * ProductPagePillarHub
 *
 * SEO-Hub-Block für Aufstiegs-Produktseiten. Verlinkt zur passenden
 * `certification_seo_pages` (Pillar) und listet 3–6 Spoke-Themen
 * (Lernfelder/Kompetenzen) aus dem Curriculum.
 *
 * Scope (Cut C, 2026-05-21): nur die 4 kaufbaren Aufstiegsfortbildungen
 * (AEVO, Betriebswirt IHK, Technischer Betriebswirt, Personalfachkaufmann).
 *
 * Resolver ist titel-basiert und renderless wenn kein Match — sicher für
 * alle anderen Produktseiten als no-op.
 */

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { ProductPageSSOT } from "@/types/product-page";

interface PillarMapping {
  pillarSlug: string;
  pillarLabel: string;
  defaultSpokes: ReadonlyArray<{ label: string; href: string }>;
}

const PILLAR_RESOLVERS: ReadonlyArray<{
  match: (title: string) => boolean;
  data: PillarMapping;
}> = [
  {
    match: (t) => /aevo|ausbildereignung/i.test(t),
    data: {
      pillarSlug: "aevo-pruefung",
      pillarLabel: "AEVO – Ausbildereignungsprüfung im Überblick",
      defaultSpokes: [
        { label: "Handlungsfeld 1: Voraussetzungen prüfen", href: "/aevo-pruefung#handlungsfeld-1" },
        { label: "Handlungsfeld 2: Ausbildung vorbereiten", href: "/aevo-pruefung#handlungsfeld-2" },
        { label: "Handlungsfeld 3: Ausbildung durchführen", href: "/aevo-pruefung#handlungsfeld-3" },
        { label: "Handlungsfeld 4: Ausbildung abschließen", href: "/aevo-pruefung#handlungsfeld-4" },
        { label: "Praktische Prüfung & Konzept", href: "/aevo-pruefung#praktisch" },
      ],
    },
  },
  {
    match: (t) => /technischer\s+betriebswirt/i.test(t),
    data: {
      pillarSlug: "technischer-betriebswirt-ihk-pruefung",
      pillarLabel: "Technischer Betriebswirt (IHK) im Überblick",
      defaultSpokes: [
        { label: "Technik-/Wirtschaftsbezogene Fragestellungen", href: "/technischer-betriebswirt-ihk-pruefung#technik-wirtschaft" },
        { label: "Management-Funktionen", href: "/technischer-betriebswirt-ihk-pruefung#management" },
        { label: "Situationsaufgabe (Projektarbeit)", href: "/technischer-betriebswirt-ihk-pruefung#situationsaufgabe" },
        { label: "Mündliche Prüfung", href: "/technischer-betriebswirt-ihk-pruefung#muendlich" },
      ],
    },
  },
  {
    match: (t) => /betriebswirt\s+ihk/i.test(t),
    data: {
      pillarSlug: "betriebswirt-ihk-pruefung",
      pillarLabel: "Geprüfter Betriebswirt (IHK) im Überblick",
      defaultSpokes: [
        { label: "Unternehmensführung", href: "/betriebswirt-ihk-pruefung#unternehmensfuehrung" },
        { label: "Marketing-Management", href: "/betriebswirt-ihk-pruefung#marketing" },
        { label: "Bilanz- & Steuerpolitik", href: "/betriebswirt-ihk-pruefung#bilanz-steuer" },
        { label: "Europäische & internationale Wirtschaftsbeziehungen", href: "/betriebswirt-ihk-pruefung#international" },
        { label: "Projektarbeit & Fachgespräch", href: "/betriebswirt-ihk-pruefung#projekt" },
      ],
    },
  },
  {
    match: (t) => /personalfachkaufmann|personalfachkauffrau/i.test(t),
    data: {
      pillarSlug: "personalfachkaufmann-ihk-pruefung",
      pillarLabel: "Personalfachkaufmann/-frau (IHK) im Überblick",
      defaultSpokes: [
        { label: "Personalarbeit organisieren", href: "/personalfachkaufmann-ihk-pruefung#organisation" },
        { label: "Personalplanung & -marketing", href: "/personalfachkaufmann-ihk-pruefung#planung" },
        { label: "Personalentwicklung", href: "/personalfachkaufmann-ihk-pruefung#entwicklung" },
        { label: "Arbeits- & sozialversicherungsrecht", href: "/personalfachkaufmann-ihk-pruefung#recht" },
        { label: "Mündliche Prüfung & Fachgespräch", href: "/personalfachkaufmann-ihk-pruefung#muendlich" },
      ],
    },
  },
];

function resolvePillar(product: ProductPageSSOT): PillarMapping | null {
  const title = product.canonicalTitle ?? "";
  for (const r of PILLAR_RESOLVERS) {
    if (r.match(title)) return r.data;
  }
  return null;
}

interface Props {
  product: ProductPageSSOT;
}

export function ProductPagePillarHub({ product }: Props) {
  const pillar = resolvePillar(product);
  if (!pillar) return null;

  const pillarHref = `/${pillar.pillarSlug}`;
  const spokes = pillar.defaultSpokes.slice(0, 6);

  return (
    <section
      aria-labelledby="pillar-hub-heading"
      className="border-y border-border-subtle bg-surface-subtle py-16"
    >
      <div className="container mx-auto max-w-5xl px-4">
        <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Pillar &amp; Themen
            </p>
            <h2
              id="pillar-hub-heading"
              className="mt-1 text-2xl font-semibold text-text-primary md:text-3xl"
            >
              {pillar.pillarLabel}
            </h2>
            <p className="mt-2 text-sm text-text-secondary md:text-base">
              Tieferer Überblick zur Prüfung, Themenstruktur und Lernpfaden — passend zu diesem Trainer.
            </p>
          </div>
          <Link
            to={pillarHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-default px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Zur Übersicht
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <ul className="grid gap-2 md:grid-cols-2">
          {spokes.map((s) => (
            <li key={s.href}>
              <Link
                to={s.href}
                className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-default px-4 py-3 text-sm text-text-primary transition hover:border-border-default hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span>{s.label}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default ProductPagePillarHub;
