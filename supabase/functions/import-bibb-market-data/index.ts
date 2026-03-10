// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * BIBB Market Data Import
 * 
 * Imports official BIBB/DAZUBI Rangliste data into beruf_market_data.
 * Uses deterministic name matching (normalize + fuzzy) to map BIBB entries to berufe.
 * 
 * Tier logic (based on Neuabschlüsse):
 *   T1: >= 15.000  → priority 2
 *   T2: >= 5.000   → priority 4  
 *   T3: >= 1.000   → priority 6
 *   T4: < 1.000    → priority 8
 * 
 * Market score (0-10) derived from demand percentile + fit heuristic.
 */

// ── BIBB Rangliste 2024 (Quelle: BIBB/DAZUBI, Stand 06.12.2024) ──────────
// Format: [beruf_name, neuabschluesse, rang, male_pct]
const BIBB_DATA_2024: [string, number, number, number][] = [
  ["Kraftfahrzeugmechatroniker/-in", 25221, 1, 93.8],
  ["Kaufmann/-frau für Büromanagement", 22245, 2, 29.3],
  ["Verkäufer/-in", 20742, 3, 52.1],
  ["Fachinformatiker/-in", 17715, 4, 89.1],
  ["Zahnmedizinischer Fachangestellte/-r", 16542, 5, 5.7],
  ["Medizinischer Fachangestellte/-r", 16278, 6, 5.1],
  ["Kaufmann/-frau im Einzelhandel", 15825, 7, 53.3],
  ["Industriekaufmann/-frau", 15660, 8, 47.2],
  ["Elektroniker/-in", 14910, 9, 96.5],
  ["Anlagenmechaniker/-in für Sanitär-, Heizungs- und Klimatechnik", 14655, 10, 97.4],
  ["Industriemechaniker/-in", 11256, 11, 93.3],
  ["Kaufmann/-frau für Groß- und Außenhandelsmanagement", 9990, 12, 61.7],
  ["Bankkaufmann/-frau", 9519, 13, 53.5],
  ["Mechatroniker/-in", 8988, 14, 92.8],
  ["Fachkraft für Lagerlogistik", 8895, 15, 86.5],
  ["Elektroniker/-in für Betriebstechnik", 7881, 16, 94.3],
  ["Koch/Köchin", 7662, 17, 74.4],
  ["Tischler/-in", 7638, 18, 78.1],
  ["Verwaltungsfachangestellter/-e", 7278, 19, 29.3],
  ["Friseur/-in", 6954, 20, 36.4],
  ["Steuerfachangestellter/-e", 6660, 21, 36.4],
  ["Hotelfachmann/-frau", 6606, 22, 34.1],
  ["Maler/-in und Lackierer/-in", 6294, 23, 78.6],
  ["Automobilkaufmann/-frau", 5727, 24, 60.5],
  ["Kaufmann/-frau für Versicherungen und Finanzanlagen", 5508, 25, 57.0],
  ["Fachlagerist/-in", 5445, 26, 89.1],
  ["Landwirt/-in", 4968, 27, 74.6],
  ["Gärtner/-in", 4770, 28, 76.9],
  ["Zimmerer/Zimmerin", 4548, 29, 92.9],
  ["Maschinen- und Anlagenführer/-in", 4458, 30, 94.2],
  ["Fachverkäufer/-in im Lebensmittelhandwerk", 4386, 31, 31.1],
  ["Kaufmann/-frau für Spedition und Logistikdienstleistung", 4293, 32, 63.3],
  ["Zerspanungsmechaniker/-in", 4272, 33, 94.0],
  ["Dachdecker/-in", 3906, 34, 95.2],
  ["Fachmann/-frau für Restaurants und Veranstaltungsgastronomie", 3846, 35, 39.2],
  ["Metallbauer/-in", 3723, 36, 95.7],
  ["Fachkraft für Gastronomie", 3318, 37, 53.5],
  ["Immobilienkaufmann/-frau", 3273, 38, 43.5],
  ["Land- und Baumaschinenmechatroniker/-in", 3108, 39, 95.2],
  ["Tiermedizinischer Fachangestellter/-e", 3093, 40, 6.3],
  ["Berufskraftfahrer/-in", 2733, 41, 90.4],
  ["Augenoptiker/-in", 2568, 42, 29.4],
  ["Sozialversicherungsfachangestellter/-e", 2550, 43, 26.1],
  ["Maurer/-in", 2550, 44, 97.5],
  ["Kaufmann/-frau im Gesundheitswesen", 2376, 45, 23.6],
  ["Elektroniker/-in für Automatisierungstechnik", 2340, 46, 92.9],
  ["Bauzeichner/-in", 2250, 47, 41.9],
  ["Chemikant/-in", 2247, 48, 86.3],
  ["Fahrzeuglackierer/-in", 2208, 49, 78.4],
  ["Rechtsanwaltsfachangestellter/-e", 2154, 50, 9.2],
  ["Technische(r) Produktdesigner/-in", 2100, 51, 64.6],
  ["Konstruktionsmechaniker/-in", 1998, 52, 95.0],
  ["Bäcker/-in", 1995, 53, 72.2],
  ["Elektroniker/-in für Geräte und Systeme", 1965, 54, 89.8],
  ["Tiefbaufacharbeiter/-in", 1959, 55, 98.7],
  ["Zahntechniker/-in", 1839, 56, 34.6],
  ["Mediengestalter/-in Digital und Print", 1827, 57, 28.0],
  ["Werkzeugmechaniker/-in", 1815, 58, 90.8],
  ["Drogist/-in", 1782, 59, 8.9],
  ["Mechatroniker/-in für Kältetechnik", 1764, 60, 97.7],
  ["Chemielaborant/-in", 1722, 61, 46.8],
  ["Konditor/-in", 1644, 62, 16.3],
  ["Karosserie- und Fahrzeugbaumechaniker/-in", 1644, 63, 94.9],
  ["Fachkraft für Metalltechnik", 1605, 64, 95.1],
  ["Veranstaltungskaufmann/-frau", 1602, 65, 31.0],
  ["Straßenbauer/-in", 1563, 66, 97.8],
  ["Fachmann/-frau für Systemgastronomie", 1515, 67, 57.2],
  ["Kaufmann/-frau im E-Commerce", 1479, 68, 61.1],
  ["Fachkraft für Veranstaltungstechnik", 1416, 69, 82.1],
  ["IT-System-Elektroniker/-in", 1410, 70, 94.8],
  ["Technischer Systemplaner/-in", 1359, 71, 70.2],
  ["Feinwerkmechaniker/-in", 1308, 72, 91.6],
  ["Pharmazeutisch-kaufmännischer Angestellter/-e", 1299, 73, 9.0],
  ["Fleischer/-in", 1245, 74, 91.3],
  ["Kunststoff- und Kautschuktechnologe/-in", 1239, 75, 92.6],
  ["Fachkraft für Schutz und Sicherheit", 1158, 76, 80.0],
  ["Anlagenmechaniker/-in", 1137, 77, 97.0],
  ["Eisenbahner/-in im Betriebsdienst Lokführer und Transport", 1110, 78, 92.3],
  ["Zweiradmechatroniker/-in", 1095, 79, 88.9],
  ["Kaufmann/-frau für Marketingkommunikation", 1080, 80, 26.2],
  ["Hörakustiker/-in", 1068, 81, 45.4],
  ["Kaufmann/-frau für IT-System-Management", 1044, 82, 80.6],
  ["Tourismuskaufmann/-frau", 1038, 83, 18.5],
  ["Sport- und Fitnesskaufmann/-frau", 1029, 84, 63.6],
  ["Industrieelektriker/-in", 996, 85, 92.7],
  ["Fachkraft Küche", 972, 86, 76.1],
  ["Fliesen-, Platten- und Mosaikleger/-in", 918, 87, 96.1],
  ["Fluggerätmechaniker/-in", 912, 88, 86.2],
  ["Informationselektroniker/-in", 912, 88, 97.0],
  ["Vermessungstechniker/-in", 885, 90, 78.4],
  ["Hochbaufacharbeiter/-in", 876, 91, 97.9],
  ["Eisenbahner/-in in der Zugverkehrssteuerung", 861, 92, 82.7],
  ["Schornsteinfeger/-in", 846, 93, 82.6],
  ["Fachkraft für Lebensmitteltechnik", 846, 94, 69.3],
  ["Forstwirt/-in", 843, 95, 88.2],
  ["Kaufmann/-frau für Digitalisierungsmanagement", 825, 96, 77.7],
  ["Kaufmann/-frau für Dialogmarketing", 810, 97, 40.4],
  ["Fachangestellter/-e für Arbeitsmarktdienstleistungen", 807, 98, 31.8],
  ["Straßenwärter/-in", 780, 99, 93.6],
  ["Justizfachangestellter/-e", 774, 100, 15.7],
  // Rang 101-150
  ["Rechtsanwalts- und Notarfachangestellter/-e", 759, 101, 8.3],
  ["Florist/-in", 723, 102, 6.1],
  ["Mediengestalter/-in Bild und Ton", 720, 103, 69.2],
  ["Pferdewirt/-in", 699, 104, 11.3],
  ["Fachangestellter/-e für Bäderbetriebe", 696, 105, 72.8],
  ["Baugeräteführer/-in", 693, 106, 95.4],
  ["Fertigungsmechaniker/-in", 675, 107, 85.7],
  ["Tierpfleger/-in", 663, 108, 27.9],
  ["Gebäudereiniger/-in", 657, 109, 81.9],
  ["Fachkraft für Kurier-, Express- und Postdienstleistungen", 615, 110, 73.7],
  ["Fachangestellter/-e für Medien- und Informationsdienste", 588, 111, 22.2],
  ["Orthopädietechnik-Mechaniker/-in", 570, 112, 43.5],
  ["Notarfachangestellter/-e", 549, 113, 17.1],
  ["Fachkraft im Fahrbetrieb", 543, 114, 84.7],
  ["Beton- und Stahlbetonbauer/-in", 525, 115, 95.2],
  ["Ausbaufacharbeiter/-in", 519, 116, 95.2],
  ["Personaldienstleistungskaufmann/-frau", 513, 117, 39.2],
  ["Buchhändler/-in", 486, 118, 12.9],
  ["Medientechnologe/-in Druck", 483, 119, 80.2],
  ["Hauswirtschafter/-in", 471, 120, 15.1],
  ["Verfahrenstechnologe Metall/-in", 468, 121, 98.3],
  ["Raumausstatter/-in", 459, 122, 31.2],
  ["Biologielaborant/-in", 456, 123, 31.0],
  ["Fachkraft für Möbel-, Küchen- und Umzugsservice", 444, 124, 95.7],
  ["Holzmechaniker/-in", 432, 125, 82.6],
  ["Gerüstbauer/-in", 429, 126, 98.1],
  ["Gestalter/-in für visuelles Marketing", 429, 127, 7.0],
  ["Stuckateur/-in", 417, 128, 91.8],
  ["Umwelttechnologe/-in für Abwasserbewirtschaftung", 408, 129, 87.8],
  ["Medienkaufmann/-frau Digital und Print", 399, 130, 24.1],
  ["Gleisbauer/-in", 381, 131, 97.4],
  ["Bestattungsfachkraft", 378, 132, 39.3],
  ["Fachkraft Agrarservice", 360, 133, 95.3],
  ["Brauer und Mälzer/-in", 357, 134, 84.6],
  ["Klempner/-in", 345, 135, 94.2],
  ["Steinmetz/-in und Steinbildhauer/-in", 339, 136, 75.4],
  ["Kaufmann/-frau für Verkehrsservice", 336, 137, 54.0],
  ["Kaufmann/-frau für Tourismus und Freizeit", 312, 138, 25.6],
  ["Pharmakant/-in", 306, 139, 47.9],
  ["Glaser/-in", 294, 140, 92.2],
  ["Tierwirt/-in", 270, 141, 46.8],
  ["Rohrleitungsbauer/-in", 261, 142, 97.7],
  ["Schilder- und Lichtreklamehersteller/-in", 261, 143, 53.1],
  ["Geomatiker/-in", 255, 144, 72.2],
  ["Kaufmann/-frau für Hotelmanagement", 249, 145, 44.6],
  ["Kosmetiker/-in", 249, 146, 2.4],
  ["Umwelttechnologe/-in für Wasserversorgung", 246, 147, 89.8],
  ["Werkstoffprüfer/-in", 246, 148, 73.9],
  ["Verfahrensmechaniker/-in für Beschichtungstechnik", 240, 149, 80.3],
  ["Werkfeuerwehrmann/-frau", 234, 150, 83.8],
  // Rang 151-200
  ["Servicekraft für Schutz und Sicherheit", 234, 150, 81.6],
  ["Elektroniker/-in für Maschinen und Antriebstechnik", 234, 152, 96.1],
  ["Packmitteltechnologe/-in", 228, 153, 88.6],
  ["Orthopädieschuhmacher/-in", 228, 154, 47.6],
  ["Milchtechnologe/-in", 225, 155, 71.1],
  ["Parkettleger/-in", 225, 156, 93.8],
  ["Winzer/-in", 222, 157, 72.4],
  ["Gießereimechaniker/-in", 222, 157, 97.3],
  ["Umwelttechnologe/-in für Rohrleitungsnetze und Industrieanlagen", 216, 159, 97.7],
  ["Fahrradmonteur/-in", 216, 159, 89.4],
  ["Produktionsfachkraft Chemie", 210, 161, 89.5],
  ["Schifffahrtskaufmann/-frau", 207, 162, 62.0],
  ["Umwelttechnologe/-in für Kreislauf- und Abfallwirtschaft", 207, 162, 84.6],
  ["Mikrotechnologe/-in", 207, 164, 72.5],
  ["Elektroniker/-in für Informations- und Systemtechnik", 201, 165, 91.5],
  ["Bootsbauer/-in", 192, 166, 83.4],
  ["Bodenleger/-in", 192, 166, 96.9],
  ["Papiertechnologe/-in", 192, 168, 92.1],
  ["Mathematisch-technische/r Softwareentwickler/-in", 186, 169, 80.6],
  ["Baustoffprüfer/-in", 183, 170, 75.3],
  ["Trockenbaumonteur/-in", 174, 171, 97.1],
  ["Milchwirtschaftlicher Laborant/-in", 174, 172, 27.7],
  ["Fotograf/-in", 171, 173, 44.1],
  ["Maßschneider/-in", 171, 173, 20.6],
  ["Goldschmied/-in", 168, 175, 19.5],
  ["Kaufmann/-frau für audiovisuelle Medien", 162, 176, 34.8],
  ["Elektroniker/-in für Gebäudesystemintegration", 153, 177, 96.7],
  ["Elektroanlagenmonteur/-in", 153, 177, 94.1],
  ["Rollladen- und Sonnenschutzmechatroniker/-in", 150, 179, 94.7],
  ["Wasserbauer/-in", 147, 180, 95.2],
  ["Medientechnologe/-in Druckverarbeitung", 138, 181, 69.8],
  ["Technische(r) Modellbauer/-in", 138, 182, 76.8],
  ["Fluggerätelektroniker/-in", 135, 183, 86.8],
  ["Schiffsmechaniker/-in", 135, 184, 81.5],
  ["Oberflächenbeschichter/-in", 132, 185, 90.2],
  ["Holzbearbeitungsmechaniker/-in", 123, 186, 92.7],
  ["Feinoptiker/-in", 123, 186, 55.6],
  ["Physiklaborant/-in", 120, 188, 71.1],
  ["Produktionstechnologe/-in", 117, 189, 88.0],
  ["Mechaniker/-in für Reifen- und Vulkanisationstechnik", 117, 190, 94.8],
  ["Binnenschiffer/-in", 114, 191, 89.6],
  ["Servicefachkraft für Dialogmarketing", 111, 192, 44.6],
  ["Kanalbauer/-in", 111, 193, 99.1],
  ["Elektroniker/-in für Maschinen und Antriebstechnik nach BBiG", 108, 194, 95.4],
  ["Verfahrenstechnologe/-in Mühlen- und Getreidewirtschaft", 108, 194, 86.1],
  ["Sattler/-in", 105, 196, 43.3],
  ["Patentanwaltsfachangestellter/-e", 102, 197, 18.4],
  ["Elektroniker/-in für Gebäude- und Infrastruktursysteme", 102, 198, 97.0],
  ["Verfahrensmechaniker/-in Glastechnik", 96, 199, 94.8],
  ["Uhrmacher/-in", 96, 200, 69.5],
  // Rang 201-280
  ["Süßwarentechnologe/-in", 93, 201, 52.2],
  ["Fachkraft für Hafenlogistik", 87, 202, 94.3],
  ["Wärme-, Kälte- und Schallschutzisolierer/-in", 87, 203, 94.2],
  ["Bergbautechnologe/-in", 84, 204, 95.3],
  ["Isolierfacharbeiter/-in", 81, 205, 97.5],
  ["Textil- und Modenäher/-in", 78, 206, 9.0],
  ["Ofen- und Luftheizungsbauer/-in", 75, 207, 92.1],
  ["Servicekaufmann/-frau im Luftverkehr", 75, 208, 34.7],
  ["Verfahrensmechaniker/-in in der Steine- und Erdenindustrie", 75, 208, 98.7],
  ["Lacklaborant/-in", 69, 210, 60.0],
  ["Medientechnologe/-in Siebdruck", 66, 211, 58.5],
  ["Sportfachmann/-frau", 63, 212, 68.3],
  ["Fischwirt/-in", 60, 213, 93.4],
  ["Fahrzeuginterieur-Mechaniker/-in", 60, 214, 40.0],
  ["Pflanzentechnologe/-in", 57, 215, 44.8],
  ["Naturwerksteinmechaniker/-in", 57, 215, 86.2],
  ["Flachglastechnologe/-in", 57, 217, 91.1],
  ["Aufbereitungsmechaniker/-in", 57, 217, 94.6],
  ["Brunnenbauer/-in", 54, 219, 94.3],
  ["Textilreiniger/-in", 51, 220, 57.7],
  ["Automatenfachmann/-frau", 51, 221, 98.0],
  ["Schädlingsbekämpfer/-in", 51, 221, 88.2],
  ["Betonfertigteilbauer/-in", 51, 221, 100.0],
  ["Produktionsmechaniker/-in Textil", 48, 224, 97.9],
  ["Maskenbildner/-in", 48, 224, 6.4],
  ["Industrie-Isolierer/-in", 45, 226, 100.0],
  ["Kaufmann/-frau für Kurier-, Express- und Postdienstleistungen", 45, 227, 77.8],
  ["Revierjäger/-in", 45, 227, 88.9],
  ["Behälter- und Apparatebauer/-in", 45, 229, 100.0],
  ["Stanz- und Umformmechaniker/-in", 45, 229, 95.5],
  ["Luftverkehrskaufmann/-frau", 45, 229, 54.5],
  ["Leichtflugzeugbauer/-in", 42, 232, 76.7],
  ["Hafenschiffer/-in", 42, 233, 92.7],
  ["Binnenschifffahrtskapitän/-in", 42, 233, 90.2],
  ["Holz- und Bautenschützer/-in", 42, 233, 97.6],
  ["Chirurgiemechaniker/-in", 39, 236, 74.4],
  ["Bühnenmaler/-in und -plastiker/-in", 36, 237, 22.2],
  ["Klavier- und Cembalobauer/-in", 36, 237, 69.4],
  ["Weintechnologe/-in", 36, 239, 82.9],
  ["Textillaborant/-in", 36, 239, 31.4],
  ["Präzisionswerkzeugmechaniker/-in", 36, 239, 85.7],
  ["Polster- und Dekorationsnäher/-in", 33, 242, 17.6],
  ["Fachangestellter/-e für Markt- und Sozialforschung", 33, 242, 58.8],
  ["Polsterer/Polsterin", 33, 244, 60.6],
  ["Büchsenmacher/-in", 33, 244, 93.9],
  ["Spezialtiefbauer/-in", 33, 246, 100.0],
  ["Servicefahrer/-in", 33, 246, 96.9],
  ["Metallblasinstrumentenmacher/-in", 30, 248, 70.0],
  ["Gestalter/-in für immersive Medien", 30, 248, 60.0],
  ["Estrichleger/-in", 30, 250, 100.0],
  ["Keramiker/-in", 30, 250, 6.9],
  ["Buchbinder/-in", 30, 250, 13.8],
  ["Fachkraft für Fruchtsafttechnik", 27, 253, 85.7],
  ["Änderungsschneider/-in", 27, 253, 25.0],
  ["Technische(r) Konfektionär/-in", 27, 253, 60.7],
  ["Destillateur/-in", 27, 256, 77.8],
  ["Orgelbauer/-in", 27, 256, 66.7],
  ["Fotomedienfachmann/-frau", 27, 258, 53.8],
  ["Textil- und Modeschneider/-in", 27, 258, 15.4],
  ["Bauwerksabdichter/-in", 24, 260, 100.0],
  ["Kürschner/-in", 21, 261, 76.2],
  ["Fachkraft für Straßen- und Verkehrstechnik", 21, 262, 60.0],
  ["Feuerungs- und Schornsteinbauer/-in", 21, 262, 100.0],
  ["Glasapparatebauer/-in", 21, 262, 65.0],
  ["Industriekeramiker/-in Anlagentechnik", 18, 265, 77.8],
  ["Segelmacher/-in", 18, 265, 38.9],
  ["Berg- und Maschinenmann/-frau", 18, 265, 100.0],
  ["Maßschuhmacher/-in", 18, 268, 47.1],
  ["Bauwerksmechaniker/-in für Abbruch und Betontrenntechnik", 18, 268, 94.1],
  ["Investmentfondskaufmann/-frau", 15, 270, 75.0],
  ["Produktveredler/-in Textil", 15, 270, 75.0],
  ["Asphaltbauer/-in", 15, 272, 100.0],
  ["Industriekeramiker/-in Verfahrenstechnik", 15, 272, 53.3],
  ["Schuhfertiger/-in", 15, 274, 85.7],
  ["Verfahrensmechaniker/-in für Brillenoptik", 15, 274, 57.1],
  ["Industriekeramiker/-in Dekorationstechnik", 15, 274, 21.4],
  ["Flechtwerkgestalter/-in", 12, 277, 0.0],
  ["Holzblasinstrumentenmacher/-in", 12, 277, 46.2],
  ["Chemielaborjungwerker/-in", 12, 278, 25.0],
  ["Glasveredler/-in", 12, 278, 25.0],
  ["Prüftechnologe/-in Keramik", 12, 278, 58.3],
  ["Manufakturporzellanmaler/-in", 6, 292, 0.0],
  ["Fassadenmonteur/-in", 6, 292, 100.0],
  ["Biologiemodellmacher/-in", 6, 286, 42.9],
  ["Produktgestalter/-in Textil", 6, 286, 14.3],
  ["Graveur/-in", 6, 288, 16.7],
  ["Seiler/-in", 6, 288, 100.0],
  ["Bürsten- und Pinselmacher/-in", 6, 292, 40.0],
  ["Fachkraft für Lederherstellung und Gerbereitechnik", 6, 292, 100.0],
];

// ── Normalization for matching ──────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/\/-?(in|r|e|er|frau|mann)/g, "")  // strip gender suffixes
    .replace(/kaufmann|kauffrau/g, "kaufm")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Jaccard on bigrams
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();
  for (let i = 0; i < na.length - 1; i++) bigramsA.add(na.slice(i, i + 2));
  for (let i = 0; i < nb.length - 1; i++) bigramsB.add(nb.slice(i, i + 2));
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersect = 0;
  for (const bg of bigramsA) if (bigramsB.has(bg)) intersect++;
  return intersect / (bigramsA.size + bigramsB.size - intersect);
}

// ── Tier & Score computation ────────────────────────────────────────────────

function computeTier(azubiCount: number): number {
  if (azubiCount >= 15000) return 1;
  if (azubiCount >= 5000) return 2;
  if (azubiCount >= 1000) return 3;
  return 4;
}

function computeMarketScore(azubiCount: number, rank: number, totalRanked: number): number {
  // Demand component (0-5): log-scaled azubi count
  const demandScore = Math.min(5, Math.log10(Math.max(azubiCount, 1)) / Math.log10(30000) * 5);
  // Rank component (0-5): inverse rank percentile
  const rankScore = Math.max(0, (1 - rank / totalRanked) * 5);
  return Math.round((demandScore + rankScore) * 100) / 100;
}

function computeDemandPercentile(rank: number, totalRanked: number): number {
  return Math.round((1 - (rank - 1) / totalRanked) * 100);
}

function computeFitScore(azubiCount: number, malePct: number): number {
  // Higher fit for digital-exam-friendly professions
  // Heuristic: higher volume + balanced gender → higher addressable market
  const volumeFit = Math.min(5, azubiCount / 6000);
  const balanceFit = 5 - Math.abs(malePct - 50) / 10; // closer to 50/50 = higher
  return Math.round(Math.max(0, Math.min(10, volumeFit + Math.max(0, balanceFit))) * 100) / 100;
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const auth = await validateAuth(req, true); // admin only
  if (auth.error) {
    if (auth.error === "Admin access required") return forbiddenResponse(auth.error);
    return unauthorizedResponse(auth.error);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Load all berufe from DB
    const { data: berufe, error: berufErr } = await supabase
      .from("berufe")
      .select("id, bezeichnung_kurz, bezeichnung_lang, bibb_id");

    if (berufErr || !berufe) throw new Error(`Failed to load berufe: ${berufErr?.message}`);

    console.log(`[BIBB-IMPORT] Loaded ${berufe.length} berufe from DB`);

    // 2. Match BIBB data → berufe
    const totalRanked = BIBB_DATA_2024.length;
    const matches: Array<{
      beruf_id: string;
      beruf_name: string;
      bibb_name: string;
      azubi_count: number;
      rank: number;
      male_pct: number;
      score: number;
    }> = [];
    const unmatched: string[] = [];

    for (const [bibbName, azubiCount, rank, malePct] of BIBB_DATA_2024) {
      let bestMatch: typeof berufe[0] | null = null;
      let bestScore = 0;

      for (const beruf of berufe) {
        // Try both short and long name
        const s1 = similarity(bibbName, beruf.bezeichnung_kurz || "");
        const s2 = similarity(bibbName, beruf.bezeichnung_lang || "");
        const s = Math.max(s1, s2);
        if (s > bestScore) {
          bestScore = s;
          bestMatch = beruf;
        }
      }

      if (bestMatch && bestScore >= 0.55) {
        matches.push({
          beruf_id: bestMatch.id,
          beruf_name: bestMatch.bezeichnung_kurz,
          bibb_name: bibbName,
          azubi_count: azubiCount,
          rank,
          male_pct: malePct,
          score: bestScore,
        });
      } else {
        unmatched.push(`${bibbName} (best: ${bestMatch?.bezeichnung_kurz} @ ${bestScore.toFixed(2)})`);
      }
    }

    console.log(`[BIBB-IMPORT] Matched: ${matches.length}/${totalRanked}, Unmatched: ${unmatched.length}`);

    // 3. Deduplicate (keep best match per beruf_id)
    const byBerufId = new Map<string, typeof matches[0]>();
    for (const m of matches) {
      const existing = byBerufId.get(m.beruf_id);
      if (!existing || m.score > existing.score) {
        byBerufId.set(m.beruf_id, m);
      }
    }

    // 4. Upsert into beruf_market_data
    let updated = 0;
    let errors = 0;

    for (const [berufId, m] of byBerufId) {
      const tier = computeTier(m.azubi_count);
      const marketScore = computeMarketScore(m.azubi_count, m.rank, totalRanked);
      const demandPercentile = computeDemandPercentile(m.rank, totalRanked);
      const fitScore = computeFitScore(m.azubi_count, m.male_pct);
      const genderBalance = Math.round((1 - Math.abs(m.male_pct - 50) / 50) * 10) / 10;

      const { error: upsertErr } = await supabase
        .from("beruf_market_data")
        .update({
          azubi_count: m.azubi_count,
          occupation_name: m.bibb_name,
          demand_percentile: demandPercentile,
          market_score: marketScore,
          fit_score: fitScore,
          gender_balance_score: genderBalance,
          tier,
          priority_rank: m.rank,
          source_year: 2024,
          source_note: "BIBB/DAZUBI Rangliste Neuabschlüsse 2024 (Tab. 67, Stand 06.12.2024)",
          match_quality: m.score >= 0.9 ? "exact" : m.score >= 0.7 ? "high" : "fuzzy",
          is_manual_override: false,
          updated_at: new Date().toISOString(),
        })
        .eq("beruf_id", berufId);

      if (upsertErr) {
        console.error(`[BIBB-IMPORT] Error updating ${berufId}: ${upsertErr.message}`);
        errors++;
      } else {
        updated++;
      }
    }

    // 5. Reprioritize active packages
    const { data: activePackages } = await supabase
      .from("course_packages")
      .select("id, course_id, priority")
      .in("status", ["building", "queued", "quality_gate_failed"]);

    let repriorized = 0;
    if (activePackages) {
      for (const pkg of activePackages) {
        // Get beruf_id through course → curriculum → beruf chain
        const { data: course } = await supabase
          .from("courses")
          .select("curriculum_id")
          .eq("id", pkg.course_id)
          .single();

        if (!course?.curriculum_id) continue;

        const { data: curriculum } = await supabase
          .from("curricula")
          .select("beruf_id")
          .eq("id", course.curriculum_id)
          .single();

        if (!curriculum?.beruf_id) continue;

        const match = byBerufId.get(curriculum.beruf_id);
        if (!match) continue;

        const tier = computeTier(match.azubi_count);
        const newPriority = tier === 1 ? 2 : tier === 2 ? 4 : tier === 3 ? 6 : 8;

        if (pkg.priority !== newPriority) {
          await supabase
            .from("course_packages")
            .update({ priority: newPriority })
            .eq("id", pkg.id);
          repriorized++;
        }
      }
    }

    const result = {
      success: true,
      source: "BIBB/DAZUBI Rangliste 2024 (Tab. 67)",
      source_date: "2024-12-06",
      total_bibb_entries: totalRanked,
      matched: byBerufId.size,
      unmatched_count: unmatched.length,
      updated,
      errors,
      repriorized_packages: repriorized,
      tier_distribution: {
        t1_above_15k: [...byBerufId.values()].filter(m => m.azubi_count >= 15000).length,
        t2_5k_15k: [...byBerufId.values()].filter(m => m.azubi_count >= 5000 && m.azubi_count < 15000).length,
        t3_1k_5k: [...byBerufId.values()].filter(m => m.azubi_count >= 1000 && m.azubi_count < 5000).length,
        t4_below_1k: [...byBerufId.values()].filter(m => m.azubi_count < 1000).length,
      },
      unmatched_sample: unmatched.slice(0, 20),
    };

    console.log(`[BIBB-IMPORT] Done:`, JSON.stringify(result, null, 2));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[BIBB-IMPORT] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
