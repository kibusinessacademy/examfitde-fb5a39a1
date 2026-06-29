import handwerk from '@/assets/berufe/handwerk.jpg';
import kaufmaennisch from '@/assets/berufe/kaufmaennisch.jpg';
import kfz from '@/assets/berufe/kfz.jpg';
import gesundheit from '@/assets/berufe/gesundheit.jpg';
import gastro from '@/assets/berufe/gastro.jpg';
import it from '@/assets/berufe/it.jpg';
import tierpflege from '@/assets/berufe/tierpflege.jpg';
import garten from '@/assets/berufe/garten.jpg';
import bau from '@/assets/berufe/bau.jpg';
import dienstleistung from '@/assets/berufe/dienstleistung.jpg';
import elektro from '@/assets/berufe/elektro.jpg';
import metall from '@/assets/berufe/metall.jpg';
import logistik from '@/assets/berufe/logistik.jpg';
import chemie from '@/assets/berufe/chemie.jpg';
import medien from '@/assets/berufe/medien.jpg';
import holz from '@/assets/berufe/holz.jpg';
import lebensmittel from '@/assets/berufe/lebensmittel.jpg';
import sicherheit from '@/assets/berufe/sicherheit.jpg';
import finanzen from '@/assets/berufe/finanzen.jpg';
import aevo from '@/assets/berufe/aevo.jpg';
import textil from '@/assets/berufe/textil.jpg';
import energie from '@/assets/berufe/energie.jpg';
import verkehr from '@/assets/berufe/verkehr.jpg';
import verkauf from '@/assets/berufe/verkauf.jpg';

type Bucket =
  | 'it' | 'gesundheit' | 'gastro' | 'kfz' | 'tierpflege' | 'garten'
  | 'bau' | 'kaufmaennisch' | 'dienstleistung' | 'handwerk'
  | 'elektro' | 'metall' | 'logistik' | 'chemie' | 'medien' | 'holz'
  | 'lebensmittel' | 'sicherheit' | 'finanzen' | 'aevo' | 'textil'
  | 'energie' | 'verkehr' | 'verkauf';

const IMAGES: Record<Bucket, string> = {
  handwerk, kaufmaennisch, kfz, gesundheit, gastro, it, tierpflege, garten,
  bau, dienstleistung, elektro, metall, logistik, chemie, medien, holz,
  lebensmittel, sicherheit, finanzen, aevo, textil, energie, verkehr, verkauf,
};

/**
 * Reihenfolge ist Priorität (specific → generic). Höher liegende Regeln
 * gewinnen — z. B. matched "Bilanzbuchhalter" zuerst auf "finanzen",
 * nicht auf das generische "kaufmaennisch".
 */
const RULES: Array<[RegExp, Bucket]> = [
  // Lehre / Ausbildung (immer zuerst — AEVO ist context-spezifisch)
  [/(aevo|ausbildereignung|ausbilder|ada[-\s]?schein)/i, 'aevo'],

  // Finanz / Rechnungswesen (vor "kaufm…")
  [/(bilanzbuchhalt|steuerfachang|steuerberat|controller|finanzbuchhalt|buchhalt|compliance|wirtschaftspr)/i, 'finanzen'],

  // IT / Software / Daten
  [/(informatik|fachinformat|systemintegrat|anwendungsentwick|software|cyber|daten|it[-\s])/i, 'it'],

  // Elektronik / Elektrotechnik (vor metall)
  [/(elektronik|elektroniker|elektroanlag|mechatron(?!.*kfz)|automatis|systemelektronik)/i, 'elektro'],

  // KFZ / Fahrzeug
  [/(kfz|kraftfahrzeug|automobil|zweirad|fahrradmontEur|karosserie|fahrzeuglackier|fahrzeuginterieur|land\-?und\-?baumaschin)/i, 'kfz'],

  // Verkehr / Transport
  [/(berufskraftfahr|eisenbahn|lokf(ü|u)hr|binnenschiff|fachkraft im fahrbetrieb|hafenlogist|kurier|post)/i, 'verkehr'],

  // Logistik / Lager
  [/(lagerlogist|fachlagerist|logistikmeister|spedition|lager)/i, 'logistik'],

  // Energie / Umwelt
  [/(energieelektronik|photovoltaik|solarteur|windenerg|umwelttechn|wasserversorgung|abwasser)/i, 'energie'],

  // Chemie / Labor / Pharma
  [/(chemie|chemikant|chemielaborant|biologielaborant|pharmaz|lacklaborant)/i, 'chemie'],

  // Gesundheit / Pflege / Medizin
  [/(pfleg|gesund|medizin|kranken|arzt|zahn|apothek|altenpfleg|hebamm|optiker|orthop(ä|a)d|h(ö|o)rakustik|augenoptik)/i, 'gesundheit'],

  // Lebensmittel-Produktion (vor Gastro)
  [/(brauer|m(ä|a)lzer|fruchtsaft|lebensmitteltechn|milchwirt|milchtechn|s(ü|u)(ß|ss)warentechn|fleischer\-?fachverk)/i, 'lebensmittel'],

  // Gastro / Küche / Hotel
  [/(koch|k(ö|o)ch|restaurant|hotel|gastro|b(ä|a)cker|konditor|fleisch|systemgastronom|fachkraft k(ü|u)che)/i, 'gastro'],

  // Medien / Druck
  [/(mediengestal|drucker|medientechnolog|buchbinder|verlagskaufm|druck\-?und\-?medien)/i, 'medien'],

  // Holz / Tischler
  [/(tischler|schreiner|holzmech|holz\-?und\-?bautensch|bootsbau|b(ö|o)gen|bogenmacher)/i, 'holz'],

  // Textil / Leder
  [/(textil|schneider|ma(ß|ss)schneider|leder|gerberei|polster|n(ä|a)her)/i, 'textil'],

  // Sicherheit
  [/(schutz und sicherheit|werkschutz|sicherheitsfachkraft|wach\-?und\-?sicher)/i, 'sicherheit'],

  // Tier / Zoo
  [/(tier|zoo|fisch|pferdew)/i, 'tierpflege'],

  // Garten / Landwirtschaft / Forst
  [/(garten|landschaft|forst|landwirt|g(ä|a)rtner|winzer|agrarservice)/i, 'garten'],

  // Bau / Hochbau / Tiefbau
  [/(maurer|zimmer|dachdeck|stra(ß|ss)enbau|beton|tiefbau|hochbau|ger(ü|u)st|asphalt|estrich|bodenleg|bauger(ä|a)t|bauzeichn|baustoff|brunnenbau|aufbereitungsmech|bergbau|fliesen)/i, 'bau'],

  // Metall / Industrie (sehr generisch — spät)
  [/(metall|industriemech|werkzeugmech|zerspan|feinwerk|maschinen.*antrieb|chirurgiemech|b(ü|u)chsenmach|edelstein)/i, 'metall'],

  // Verkauf / Einzelhandel (vor Dienstleistung)
  [/(verk(ä|a)ufer|einzelhandel|kaufm.*einzelhandel|drogist|buchh(ä|a)ndler|automatenfach|fachverk(ä|a)ufer)/i, 'verkauf'],

  // Dienstleistung / Beauty / Sport / Tourismus
  [/(friseur|kosmetik|stylist|fitness|sport|reise|tourismus|veranstaltungstechn|servicekraft)/i, 'dienstleistung'],

  // Kaufmännisch (generisch — letzter Sammler)
  [/(kaufm|kauffrau|kaufmann|b(ü|u)ro|industriekaufm|bank|versicher|immobilien|personal|marketing|management|betriebswirt|fachangestell)/i, 'kaufmaennisch'],
];

export function getBerufImage(title: string, kammer?: string | null): string {
  for (const [re, bucket] of RULES) {
    if (re.test(title)) return IMAGES[bucket];
  }
  if (kammer === 'HWK') return IMAGES.handwerk;
  if (kammer === 'IHK') return IMAGES.kaufmaennisch;
  if (kammer === 'Lw' || kammer === 'LWK') return IMAGES.garten;
  return IMAGES.handwerk;
}
