// Adapted from dl-cms/cms/src/server/auth/user-agent.ts
/**
 * "Chrome on macOS" from a User-Agent header, for the sessions and trusted-browser lists and the new-browser
 * email. Pure, so the mock uses it too. Order matters: Edge and Opera say Chrome, Chrome says Safari.
 */
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/^curl\//, 'curl'],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

export function browserLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (!ua.trim()) return 'Unknown browser';
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `A browser on ${system}` : 'Unknown browser');
}
