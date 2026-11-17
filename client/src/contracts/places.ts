/** A place from /api/places: GeoNames cities and countries (CC BY 4.0). */
export type Place = {
  name: string;
  kind: 'city' | 'country';
  /** "City, QLD" or "Country". */
  detail: string;
  /** ISO country code, like "AU". */
  country: string;
  lat: number | null;
  lng: number | null;
};
