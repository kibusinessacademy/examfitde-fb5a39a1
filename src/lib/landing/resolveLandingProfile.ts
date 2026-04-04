export type LandingType =
  | "AZUBI"
  | "FORTBILDUNG"
  | "ZERTIFIKAT"
  | "BETRIEB"
  | "INSTITUTION";

export function resolveDefaultLandingType(input: {
  track: string;
  certificationType: string;
}): LandingType {
  if (input.track === "AUSBILDUNG") return "AZUBI";
  if (input.track === "FORTBILDUNG") return "FORTBILDUNG";
  if (input.track === "CERTIFICATION" || input.track === "ZERTIFIKAT") return "ZERTIFIKAT";
  return "AZUBI";
}
