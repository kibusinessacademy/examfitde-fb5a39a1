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

type Bucket =
  | 'it' | 'gesundheit' | 'gastro' | 'kfz' | 'tierpflege' | 'garten'
  | 'bau' | 'kaufmaennisch' | 'dienstleistung' | 'handwerk';

const IMAGES: Record<Bucket, string> = {
  handwerk, kaufmaennisch, kfz, gesundheit, gastro, it, tierpflege, garten, bau, dienstleistung,
};

const RULES: Array<[RegExp, Bucket]> = [
  [/(informat|fachinformat|system|software|it[-\s]|cyber|daten)/i, 'it'],
  [/(pfleg|gesund|medizin|kranken|arzt|zahn|apothek|altenpfleg|hebamm)/i, 'gesundheit'],
  [/(koch|köch|restaurant|hotel|gastro|bäcker|baecker|konditor|fleisch|fachkraft.*gastro|systemgastronom)/i, 'gastro'],
  [/(kfz|kraftfahrzeug|mechatron|automobil|zweirad|land\-?und\-?baumaschin)/i, 'kfz'],
  [/(tier|zoo|fisch|pferdew)/i, 'tierpflege'],
  [/(garten|landschaft|forst|landwirt|gärtner|gaertner|winzer)/i, 'garten'],
  [/(bau|maurer|zimmer|dachdeck|stra(ß|ss)enbau|beton|tiefbau|hochbau|geru(e|ü)st)/i, 'bau'],
  [/(friseur|kosmetik|stylist|fitness|sport|reise|tourismus|verkauf|einzelhandel)/i, 'dienstleistung'],
  [/(kaufm|kauffrau|kaufmann|büro|buero|industrie|spedition|bank|versicher|immobilien|steuer|personal|marketing|management)/i, 'kaufmaennisch'],
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
