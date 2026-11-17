import fs from 'node:fs';
import path from 'node:path';
import type { Place } from '@/contracts/places';

/**
 * Place search for the places control. Countries come from the runtime's own ISO region names; cities come
 * from GeoNames (cities with 15,000 people or more, CC BY 4.0, credited in the README), in
 * data/cities.tsv: name, region, country code, latitude, longitude, population. Loaded once, searched in
 * memory.
 */
type Entry = Place & { key: string; population: number };

const NON_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB', 'AA']);

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

let countries: Entry[] | null = null;
let cities: Entry[] | null = null;
const countryNames = new Map<string, string>();

function loadCountries(): Entry[] {
  if (countries) return countries;
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const out: Entry[] = [];
  for (let a = 65; a <= 90; a++)
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (NON_COUNTRIES.has(code)) continue;
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        continue;
      }
      if (!name || name === code || /unknown/i.test(name)) continue;
      countryNames.set(code, name);
      out.push({ name, kind: 'country', detail: 'Country', country: code, lat: null, lng: null, key: normalise(name), population: Infinity });
    }
  countries = out;
  return out;
}

/** Where the cities file is: next to this module in the source tree, or under the app's working folder. */
function citiesFile(): string | null {
  for (const candidate of [
    path.join(process.cwd(), 'src/server/places/data/cities.tsv'),
    path.join(process.cwd(), 'places/cities.tsv'),
  ])
    if (fs.existsSync(candidate)) return candidate;
  return null;
}

function loadCities(): Entry[] {
  if (cities) return cities;
  loadCountries();
  const file = citiesFile();
  if (!file) return (cities = []);
  const out: Entry[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [name, region, country, lat, lng, population] = line.split('\t');
    if (!name || !country) continue;
    const countryName = countryNames.get(country) ?? country;
    out.push({
      name,
      kind: 'city',
      detail: region ? `City, ${region}` : `City, ${countryName}`,
      country,
      lat: Number(lat),
      lng: Number(lng),
      key: normalise(name),
      population: Number(population) || 0,
    });
  }
  cities = out;
  return out;
}

/** True when the cities file is there (the README says how to make it). */
export function hasCities(): boolean {
  return loadCities().length > 0;
}

/** Places whose name starts with the text (or has a word that does), countries first, then by size. */
export function searchPlaces(text: string, limit = 8): Place[] {
  const q = normalise(text);
  if (q.length < 2) return [];
  const score = (e: Entry) => {
    if (e.key === q) return 0;
    if (e.key.startsWith(q)) return 1;
    if (e.key.includes(` ${q}`) || e.key.includes(`-${q}`)) return 2;
    return -1;
  };
  const hits: { e: Entry; s: number }[] = [];
  for (const e of [...loadCountries(), ...loadCities()]) {
    const s = score(e);
    if (s >= 0) hits.push({ e, s });
  }
  hits.sort((a, b) => a.s - b.s || (a.e.kind === b.e.kind ? 0 : a.e.kind === 'country' ? -1 : 1) || b.e.population - a.e.population);
  return hits.slice(0, limit).map(({ e }) => ({
    name: e.name,
    kind: e.kind,
    detail: e.detail,
    country: e.country,
    lat: e.lat,
    lng: e.lng,
  }));
}
