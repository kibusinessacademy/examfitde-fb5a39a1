import { ReactNode } from "react";
import { BerufOSHeader } from "./BerufOSHeader";
import { BerufOSFooter } from "./BerufOSFooter";
import "./berufos-theme.css";

/**
 * Public-Hub-Shell für Marketing-/Public-Seiten ohne eigene Navigation
 * (Suites, Branchen, Produkte, ...). Stellt sicher, dass der Besucher nie
 * "gestrandet" ist und immer zurück zum BerufOS-Hub navigieren kann.
 *
 * Eingeführt nach Systemaudit 2026-05-29 (D2/D3: missing header on /suites,
 * /branchen).
 */
export function PublicHubLayout({ children }: { children: ReactNode }) {
  return (
    <div className="berufos min-h-screen bg-background flex flex-col">
      <BerufOSHeader />
      <div className="flex-1">{children}</div>
      <BerufOSFooter />
    </div>
  );
}
