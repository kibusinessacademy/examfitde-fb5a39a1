export type Track =
  | "AUSBILDUNG"
  | "STUDIUM"
  | "FORTBILDUNG"
  | "CERTIFICATION";

/**
 * Derives the DB-level certification_type enum from a classification Track + CertificationType.
 */
export function deriveDbCertificationType(track: Track, certType: CertificationType): string {
  if (track === "STUDIUM") return "studium";
  if (track === "FORTBILDUNG") {
    if (certType === "IHK_AUFSTIEG" || certType === "MEISTER" || certType === "AEVO" || certType === "FINANCE")
      return "fortbildung_ihk";
    return "fortbildung_ihk";
  }
  if (track === "CERTIFICATION") return "branchenzertifikat";
  return "ausbildung";
}

/**
 * Derives the DB-level product_track enum from a classification Track.
 */
export function deriveDbTrack(track: Track): string {
  const map: Record<Track, string> = {
    AUSBILDUNG: "AUSBILDUNG_VOLL",
    FORTBILDUNG: "EXAM_FIRST_PLUS",
    CERTIFICATION: "EXAM_FIRST_PLUS",
    STUDIUM: "STUDIUM",
  };
  return map[track] ?? "AUSBILDUNG_VOLL";
}

export type ValidationProfile =
  | "AUSBILDUNG_VOLL"
  | "AUSBILDUNG_LIGHT"
  | "STUDIUM"
  | "WEITERBILDUNG"
  | "IHK_AUFSTIEG"
  | "MEISTER"
  | "AEVO"
  | "FINANCE"
  | "CERT_TECH"
  | "SECURITY"
  | "PRIVACY";

export type CertificationType =
  | "IHK_AUFSTIEG"
  | "MEISTER"
  | "AEVO"
  | "FINANCE"
  | "PROJECT_MANAGEMENT"
  | "CLOUD"
  | "SECURITY"
  | "DATA"
  | "PRIVACY"
  | "ERP"
  | "GENERAL";

export type BlueprintType =
  | "concept"
  | "scenario"
  | "calculation"
  | "framework"
  | "case";
