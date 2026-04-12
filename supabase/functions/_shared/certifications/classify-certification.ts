import type { CertificationType, Track, ValidationProfile } from "./types.ts";

export type OralTrainerMode = "official_simulation" | "didactic_viva";

export type ClassificationResult = {
  track: Track;
  certificationType: CertificationType;
  validationProfile: ValidationProfile;
  examModes: string[];
  /** Formal truth: does the real exam have an oral component? */
  oralExamEnabled: boolean;
  /** Product module: always true — trainer is available for all */
  oralTrainerEnabled: true;
  /** Derived mode based on formal exam structure */
  oralTrainerMode: OralTrainerMode;
  calculationHeavy: boolean;
  frameworkHeavy: boolean;
};

export function classifyCertification(title: string): ClassificationResult {
  const n = title.trim().toLowerCase();

  // AEVO
  if (n.includes("aevo") || n.includes("ausbildung der ausbilder") || n.includes("ausbilderschein")) {
    return {
      track: "FORTBILDUNG",
      certificationType: "AEVO",
      validationProfile: "AEVO",
      examModes: ["schriftlich", "muendlich", "praesentation"],
      oralExamEnabled: true,
      calculationHeavy: false,
      frameworkHeavy: false,
    };
  }

  // Meister
  if (n.includes("meister")) {
    return {
      track: "FORTBILDUNG",
      certificationType: "MEISTER",
      validationProfile: "MEISTER",
      examModes: ["schriftlich", "muendlich"],
      oralExamEnabled: true,
      calculationHeavy: false,
      frameworkHeavy: false,
    };
  }

  // IHK Aufstieg (Fachwirt, Betriebswirt, Bilanzbuchhalter, Personalfachkaufmann)
  if (n.includes("fachwirt") || n.includes("betriebswirt") || n.includes("bilanzbuchhalter") || n.includes("personalfachkauf")) {
    return {
      track: "FORTBILDUNG",
      certificationType: "IHK_AUFSTIEG",
      validationProfile: n.includes("bilanzbuchhalter") ? "FINANCE" : "IHK_AUFSTIEG",
      examModes: ["schriftlich"],
      oralExamEnabled: false,
      calculationHeavy: n.includes("bilanzbuchhalter"),
      frameworkHeavy: false,
    };
  }

  // Project Management
  if (n.includes("scrum") || n.includes("prince2") || n.includes("itil") || n.includes("pmp") || n.includes("ipma")) {
    return {
      track: "CERTIFICATION",
      certificationType: "PROJECT_MANAGEMENT",
      validationProfile: "CERT_TECH",
      examModes: ["schriftlich"],
      oralExamEnabled: false,
      calculationHeavy: false,
      frameworkHeavy: true,
    };
  }

  // Cloud
  if (n.includes("aws") || n.includes("azure") || n.includes("google cloud") || n.includes("ccna") || n.includes("ccnp")) {
    return {
      track: "CERTIFICATION",
      certificationType: "CLOUD",
      validationProfile: "CERT_TECH",
      examModes: ["schriftlich"],
      oralExamEnabled: false,
      calculationHeavy: false,
      frameworkHeavy: true,
    };
  }

  // Security
  if (n.includes("cissp") || n.includes("cism") || n.includes("cisa") || n.includes("ceh") || n.includes("security+")) {
    return {
      track: "CERTIFICATION",
      certificationType: "SECURITY",
      validationProfile: "SECURITY",
      examModes: ["schriftlich"],
      oralExamEnabled: false,
      calculationHeavy: false,
      frameworkHeavy: true,
    };
  }

  // Data
  if (n.includes("data") || n.includes("tableau") || n.includes("sas") || n.includes("analytics")) {
    return {
      track: "CERTIFICATION",
      certificationType: "DATA",
      validationProfile: "CERT_TECH",
      examModes: ["schriftlich"],
      oralExamEnabled: false,
      calculationHeavy: false,
      frameworkHeavy: false,
    };
  }

  // ERP
  if (n.includes("sap")) {
    return {
      track: "CERTIFICATION",
      certificationType: "ERP",
      validationProfile: "CERT_TECH",
      examModes: ["schriftlich"],
      oralExamEnabled: false,
      calculationHeavy: false,
      frameworkHeavy: true,
    };
  }

  // Privacy
  if (n.includes("gdpr") || n.includes("iapp") || n.includes("datenschutz")) {
    return {
      track: "CERTIFICATION",
      certificationType: "PRIVACY",
      validationProfile: "PRIVACY",
      examModes: ["schriftlich"],
      oralExamEnabled: false,
      calculationHeavy: false,
      frameworkHeavy: true,
    };
  }

  // STUDIUM / Hochschule
  if (
    n.includes("bachelor") || n.includes("master") || n.includes("studium") ||
    n.includes("dual") || n.includes("hochschule") || n.includes("universität") ||
    n.includes("university") || n.includes("semester") || n.includes("ects") ||
    n.includes("modulprüfung") || n.includes("klausur")
  ) {
    return {
      track: "STUDIUM" as Track,
      certificationType: "GENERAL",
      validationProfile: "STUDIUM",
      examModes: ["schriftlich"],
      oralExamEnabled: false,
      calculationHeavy: false,
      frameworkHeavy: false,
    };
  }

  // Default
  return {
    track: "CERTIFICATION",
    certificationType: "GENERAL",
    validationProfile: "CERT_TECH",
    examModes: ["schriftlich"],
    oralExamEnabled: false,
    calculationHeavy: false,
    frameworkHeavy: false,
  };
}
