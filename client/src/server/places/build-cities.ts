import fs from 'node:fs';
import path from 'node:path';

/**
 * Builds data/cities.tsv for the places control from two GeoNames files (CC BY 4.0, credited in the README):
 *
 *   curl -O https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
 *   curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
 *   npx tsx src/server/places/build-cities.ts cities15000.txt admin1CodesASCII.txt
 *
 * Each line: name, region, country code, latitude, longitude, population (tab-separated), biggest first.
 */
const [citiesFile, admin1File] = process.argv.slice(2);
if (!citiesFile || !admin1File) {
  console.error('Usage: tsx src/server/places/build-cities.ts cities15000.txt admin1CodesASCII.txt');
  process.exit(1);
}

const clean = (text: string) => text.replace(/[\t\r\n]+/g, ' ').trim();

const regions = new Map<string, string>();
for (const line of fs.readFileSync(admin1File, 'utf8').split('\n')) {
  const [code, name] = line.split('\t');
  if (code && name) regions.set(code, clean(name));
}

type City = { name: string; region: string; country: string; lat: string; lng: string; population: number };
const cities: City[] = [];
for (const line of fs.readFileSync(citiesFile, 'utf8').split('\n')) {
  const f = line.split('\t');
  // geonameid, name, asciiname, alternatenames, latitude, longitude, feature class, feature code, country
  // code, cc2, admin1 code, admin2, admin3, admin4, population, ...
  if (f.length < 15 || !f[1]) continue;
  cities.push({
    name: clean(f[1]),
    region: regions.get(`${f[8]}.${f[10]}`) ?? '',
    country: f[8],
    lat: Number(f[4]).toFixed(4),
    lng: Number(f[5]).toFixed(4),
    population: Number(f[14]) || 0,
  });
}
cities.sort((a, b) => b.population - a.population);

const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'data', 'cities.tsv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  cities.map((c) => [c.name, c.region, c.country, c.lat, c.lng, c.population].join('\t')).join('\n') + '\n',
);
console.log(`[places] ${cities.length.toLocaleString('en-US')} cities written to ${path.relative(process.cwd(), out)}`);
