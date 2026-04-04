import type { BlueprintType, CertificationType, ValidationProfile } from "./types.ts";

export function selectBlueprintTypes(input: {
  certificationType: CertificationType;
  validationProfile: ValidationProfile;
  calculationHeavy: boolean;
  frameworkHeavy: boolean;
}): BlueprintType[] {
  if (input.validationProfile === "AEVO") {
    return ["case", "scenario", "concept"];
  }

  if (input.validationProfile === "FINANCE" || input.calculationHeavy) {
    return ["calculation", "scenario", "concept"];
  }

  if (input.frameworkHeavy) {
    return ["framework", "scenario", "concept"];
  }

  switch (input.certificationType) {
    case "IHK_AUFSTIEG":
    case "MEISTER":
      return ["scenario", "concept"];
    case "SECURITY":
      return ["framework", "scenario", "concept"];
    default:
      return ["concept", "scenario"];
  }
}
