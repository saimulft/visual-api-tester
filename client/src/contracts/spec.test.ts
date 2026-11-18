import { describe, expect, it } from 'vitest';
import coresignal from '../server/seed/specs/coresignal.json';
import hackerNews from '../server/seed/specs/hacker-news.json';
import openMeteo from '../server/seed/specs/open-meteo.json';
import { allControls, channelNumber, checkSpec, type ApiSpec } from './spec';
import { defaultValues, isChanged, isEmptyValue, resolveValues } from './values';

const seeds = { coresignal, hackerNews, openMeteo } as Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const problemsFor = (spec: unknown) => {
  const result = checkSpec(spec);
  if (result.ok) throw new Error('expected the spec to fail');
  return result.problems;
};
const messages = (spec: unknown) =>
  problemsFor(spec)
    .map((p) => p.message)
    .join('\n');

describe('seed specs', () => {
  for (const [name, spec] of Object.entries(seeds))
    it(`${name} passes the contract`, () => {
      const result = checkSpec(spec);
      if (!result.ok) throw new Error(result.problems.map((p) => `${p.path}: ${p.message}`).join('\n'));
      expect(result.spec.version).toBe(1);
    });

  it('gives every control a start value, and nothing starts as changed', () => {
    const spec = checkSpec(coresignal);
    if (!spec.ok) throw new Error('coresignal');
    const values = defaultValues(spec.spec);
    expect(values.country).toEqual(['Australia']);
    expect(values.employees).toEqual({ min: 50, max: 200 });
    expect(values.keywords).toEqual([]);
    for (const control of allControls(spec.spec)) expect(isChanged(control, values[control.id])).toBe(false);
    const employees = allControls(spec.spec).find((c) => c.id === 'employees')!;
    expect(isChanged(employees, { max: 200, min: 50 })).toBe(false);
    expect(isChanged(employees, { min: 10, max: 200 })).toBe(true);
    expect(isEmptyValue(values.keywords)).toBe(true);
  });

  it('resolves values and reports wrong ones plainly', () => {
    const spec = checkSpec(hackerNews);
    if (!spec.ok) throw new Error('hn');
    const ok = resolveValues(spec.spec, { query: 'agents' });
    expect(ok.problems).toEqual([]);
    expect(ok.values.query).toBe('agents');
    expect(ok.values.type).toBe('show_hn');
    const bad = resolveValues(spec.spec, { type: 'jobs', points: 5000 });
    expect(bad.problems.map((p) => p.message).join('\n')).toMatch(/no option "jobs"[\s\S]*between 0 and 1000/);
  });

  it('numbers channels CH 01 onward', () => {
    expect(channelNumber(0)).toBe('CH 01');
    expect(channelNumber(9)).toBe('CH 10');
  });
});

describe('broken specs fail with messages an AI can act on', () => {
  it('names a missing endpoint and lists the real ones', () => {
    const spec = clone(coresignal) as ApiSpec;
    spec.channels[0].controls[0].endpointId = 'serch';
    expect(messages(spec)).toMatch(/points at endpoint "serch", which doesn't exist\. Use one of: "search", "collect"/);
  });

  it('wants https and no trailing slash on the base URL', () => {
    const spec = clone(openMeteo) as ApiSpec;
    spec.api.baseUrl = 'http://api.open-meteo.com/v1';
    expect(messages(spec)).toMatch(/https:\/\//);
    spec.api.baseUrl = 'https://api.open-meteo.com/v1/';
    expect(messages(spec)).toMatch(/trailing/);
  });

  it('keeps free endpoints at zero cost', () => {
    const spec = clone(hackerNews) as ApiSpec;
    spec.endpoints[0].cost.perRecord = 1;
    expect(messages(spec)).toMatch(/marked free, so its cost must be 0/);
  });

  it('won’t let a paid CoreSignal endpoint be free or cost nothing', () => {
    const free = clone(coresignal) as ApiSpec;
    const collect = free.endpoints.find((e) => e.id === 'collect')!;
    Object.assign(collect, { free: true, cost: { perCall: 0, perRecord: 0, unit: 'credits' } });
    expect(messages(free)).toMatch(/"collect" can't be free/);
    const zero = clone(coresignal) as ApiSpec;
    zero.endpoints.find((e) => e.id === 'collect')!.cost.perRecord = 0;
    expect(messages(zero)).toMatch(/"collect" costs credits/);
  });

  it('rejects duplicate ids and a run that points nowhere', () => {
    const spec = clone(hackerNews) as ApiSpec;
    spec.channels[1].controls[0].id = 'query';
    spec.run = { mode: 'single', endpointId: 'nope', takeControlId: 'missing' };
    const text = messages(spec);
    expect(text).toMatch(/Two controls share the id "query"/);
    expect(text).toMatch(/run points at endpoint "nope"/);
    expect(text).toMatch(/takeControlId is "missing", but no control has that id/);
  });

  it('caps controls at 40 and channels at 8', () => {
    const spec = clone(hackerNews) as ApiSpec;
    const base = spec.channels[0].controls[0];
    const channels = (count: number, each: number) =>
      Array.from({ length: count }, (_, c) => ({
        id: `ch-${c}`,
        title: `Channel ${c}`,
        controls: Array.from({ length: each }, (_, k) => ({ ...base, id: `c-${c}-${k}` })),
      }));
    spec.channels = channels(9, 1);
    expect(messages(spec)).toMatch(/8 channels or fewer/);
    spec.channels = channels(8, 6);
    expect(messages(spec)).toMatch(/48 controls; keep it to 40 or fewer/);
  });

  it('checks the shape of each kind', () => {
    const spec = clone(openMeteo) as ApiSpec;
    const daily = spec.channels[1].controls[1];
    daily.default = ['snowfall'];
    const units = spec.channels[1].controls[2];
    units.options = [{ value: 'celsius', label: 'C' }];
    const days = spec.channels[1].controls[0];
    delete days.max;
    const text = messages(spec);
    expect(text).toMatch(/has no option "snowfall"/);
    expect(text).toMatch(/shows 2 to 8 options/);
    expect(text).toMatch(/give it "min" and "max"/);
  });

  it('gives a dot path with each problem', () => {
    const spec = clone(coresignal) as ApiSpec;
    spec.channels[2].controls[0].kind = 'mapRadius';
    const problems = problemsFor(spec);
    expect(problems.some((p) => p.path === 'channels.2.controls.0.key')).toBe(true);
  });

  it('explains a wrong kind or auth type', () => {
    const spec = clone(openMeteo) as Record<string, unknown> & { api: { auth: unknown } };
    spec.api.auth = { type: 'oauth' };
    expect(messages(spec)).toMatch(/auth.type must be one of: none, header, query, bearer, basic/);
  });
});
