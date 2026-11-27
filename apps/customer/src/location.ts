import { EMIRATE_CODES, type EmirateCode } from '@jays/domain';

/**
 * Approximate emirate centres. Used only to pre-select an emirate from device location; the user
 * always confirms or changes it, and manual choice works without location permission.
 */
const CENTRES: Record<EmirateCode, [number, number]> = {
  AUH: [24.0, 54.0],
  DXB: [25.08, 55.25],
  SHJ: [25.33, 55.45],
  AJM: [25.41, 55.52],
  UAQ: [25.52, 55.7],
  RAK: [25.75, 56.0],
  FUJ: [25.3, 56.3],
};

export function nearestEmirate(latitude: number, longitude: number): EmirateCode {
  let best: EmirateCode = EMIRATE_CODES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const code of EMIRATE_CODES) {
    const [lat, lng] = CENTRES[code];
    const distance =
      (lat - latitude) ** 2 + ((lng - longitude) * Math.cos((latitude * Math.PI) / 180)) ** 2;
    if (distance < bestDistance) {
      best = code;
      bestDistance = distance;
    }
  }
  return best;
}

/** Bundled names so the emirate list still works offline. The API list wins when reachable. */
export const FALLBACK_EMIRATES: { code: EmirateCode; name: { en: string; ar: string } }[] = [
  { code: 'AUH', name: { en: 'Abu Dhabi', ar: 'أبوظبي' } },
  { code: 'DXB', name: { en: 'Dubai', ar: 'دبي' } },
  { code: 'SHJ', name: { en: 'Sharjah', ar: 'الشارقة' } },
  { code: 'AJM', name: { en: 'Ajman', ar: 'عجمان' } },
  { code: 'UAQ', name: { en: 'Umm Al Quwain', ar: 'أم القيوين' } },
  { code: 'RAK', name: { en: 'Ras Al Khaimah', ar: 'رأس الخيمة' } },
  { code: 'FUJ', name: { en: 'Fujairah', ar: 'الفجيرة' } },
];
