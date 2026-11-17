import { describe, expect, it } from 'vitest';
import { allControls, checkSpec, valueProblem, type ApiSpec, type Control, type Value } from '@/contracts/spec';
import { isChanged, startValue } from '@/contracts/values';
import { buildRequest } from '@/server/runner/request';
import coresignalJson from '@/server/seed/specs/coresignal.json';
import hackerNewsJson from '@/server/seed/specs/hacker-news.json';
import openMeteoJson from '@/server/seed/specs/open-meteo.json';
import {
  addWords,
  dialAngle,
  dialValueAt,
  fromPosition,
  niceLog,
  rangeText,
  scaleOf,
  splitWords,
  ticksOf,
  toPosition,
} from './scale';

const spec = (input: unknown): ApiSpec => {
  const checked = checkSpec(input);
  if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
  return checked.spec;
};

const control = (over: Partial<Control> & Pick<Control, 'kind'>): Control =>
  ({ id: 'c', label: 'C', param: 'c', endpointId: 'e', in: 'query', key: 'c', by: 'ai', ...over }) as Control;

describe('fader and dial scales', () => {
  it('round-trips linear values through knob positions', () => {
    const scale = scaleOf(control({ kind: 'range', min: 1990, max: 2025, step: 1 }));
    for (const v of [1990, 2000, 2012, 2022, 2025]) expect(fromPosition(toPosition(v, scale), scale)).toBe(v);
    expect(ticksOf(scale).map((t) => t.label)).toEqual(['1990', '2000', '2010', '2020', '2025']);
  });

  it('round-trips log values, each decade the same width', () => {
    const scale = scaleOf(control({ kind: 'logRange', min: 1, max: 10000 }));
    expect(toPosition(10, scale)).toBeCloseTo(25);
    expect(toPosition(100, scale)).toBeCloseTo(50);
    expect(toPosition(1000, scale)).toBeCloseTo(75);
    for (const v of [1, 50, 200, 1000, 4500, 10000]) expect(fromPosition(toPosition(v, scale), scale)).toBe(v);
    expect(niceLog(1234)).toBe(1200);
    expect(niceLog(187)).toBe(190);
    expect(ticksOf(scale).map((t) => t.label)).toEqual(['1', '10', '100', '1k', '10k']);
    expect(rangeText({ min: 50, max: 200 }, scale)).toBe('50 to 200');
    expect(rangeText({ min: 200, max: 10000 }, scale)).toBe('200 to 10,000+');
    expect(rangeText({}, scale)).toBe('Any');
  });

  it('round-trips the amount stepper scale and the dial', () => {
    const amount = scaleOf(control({ kind: 'amount', min: 5, max: 50, step: 5 }));
    for (const v of [5, 25, 50]) expect(fromPosition(toPosition(v, amount), amount)).toBe(v);
    const dial = scaleOf(control({ kind: 'dial', min: 0, max: 10, step: 1 }));
    expect(dialAngle(2, dial)).toBe(-81); // the board's "2 or more" hand
    for (const v of [0, 2, 5, 10]) expect(dialValueAt(dialAngle(v, dial), dial)).toBe(v);
  });

  it('splits and dedupes keywords', () => {
    expect(splitWords('payments, fintech;\nSaaS ')).toEqual(['payments', 'fintech', 'SaaS']);
    expect(addWords(['Fintech'], ['fintech', 'b2b'])).toEqual(['Fintech', 'b2b']);
  });
});

describe('every kind’s value reaches the request', () => {
  const kinds: {
    control: Partial<Control> & Pick<Control, 'kind'>;
    value: Value;
    expect: (q: URLSearchParams) => void;
  }[] = [
    { control: { kind: 'text' }, value: 'kestrel', expect: (q) => expect(q.get('c')).toBe('kestrel') },
    {
      control: { kind: 'keywords' },
      value: splitWords('a, b'),
      expect: (q) => expect(q.getAll('c')).toEqual(['a', 'b']),
    },
    {
      control: {
        kind: 'choice',
        options: [
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
        ],
      },
      value: 'y',
      expect: (q) => expect(q.get('c')).toBe('y'),
    },
    {
      control: {
        kind: 'multi',
        format: 'comma',
        options: [
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
        ],
      },
      value: ['x', 'y'],
      expect: (q) => expect(q.get('c')).toBe('x,y'),
    },
    { control: { kind: 'toggle' }, value: true, expect: (q) => expect(q.get('c')).toBe('true') },
    {
      control: { kind: 'range', min: 1990, max: 2025, key: { min: 'from', max: 'to' } },
      value: { min: fromPosition(40, scaleOf({ kind: 'range', min: 1990, max: 2025 })), max: 2020 },
      expect: (q) => expect([q.get('from'), q.get('to')]).toEqual(['2004', '2020']),
    },
    {
      control: { kind: 'logRange', min: 1, max: 10000, key: { min: 'gte', max: 'lte' } },
      value: { min: fromPosition(42.5, scaleOf({ kind: 'logRange', min: 1, max: 10000 })), max: 200 },
      expect: (q) => expect([q.get('gte'), q.get('lte')]).toEqual(['50', '200']),
    },
    {
      control: { kind: 'dial', min: 0, max: 10 },
      value: dialValueAt(
        dialAngle(3, scaleOf({ kind: 'dial', min: 0, max: 10 })),
        scaleOf({ kind: 'dial', min: 0, max: 10 }),
      ),
      expect: (q) => expect(q.get('c')).toBe('3'),
    },
    {
      control: { kind: 'date', format: 'unix' },
      value: '2026-11-01',
      expect: (q) => expect(q.get('c')).toBe(String(Date.UTC(2026, 10, 1) / 1000)),
    },
    {
      control: { kind: 'date', range: true, key: { min: 'since', max: 'until' } },
      value: { min: '2026-01-01', max: '2026-11-17' },
      expect: (q) => expect([q.get('since'), q.get('until')]).toEqual(['2026-01-01', '2026-11-17']),
    },
    { control: { kind: 'amount', min: 5, max: 50, step: 5 }, value: 25, expect: (q) => expect(q.get('c')).toBe('25') },
    {
      control: { kind: 'places', format: 'comma' },
      value: ['Sydney', 'Melbourne'],
      expect: (q) => expect(q.get('c')).toBe('Sydney,Melbourne'),
    },
    {
      control: { kind: 'mapRadius', key: { lat: 'lat', lng: 'lng', radius: 'r' } },
      value: { lat: -33.885, lng: 151.211, radius: 1.5 },
      expect: (q) => expect([q.get('lat'), q.get('lng'), q.get('r')]).toEqual(['-33.885', '151.211', '1.5']),
    },
  ];

  it.each(kinds.map((k) => [k.control.kind + (k.control.range ? ' range' : ''), k] as const))('%s', (_, k) => {
    const c = control({ ...k.control, endpointId: 'e' });
    expect(valueProblem(c, k.value)).toBeNull();
    const s = spec({
      version: 1,
      api: {
        name: 'T',
        slug: 't',
        baseUrl: 'https://api.example.com',
        docsUrl: 'https://example.com',
        auth: { type: 'none' },
      },
      endpoints: [
        {
          id: 'e',
          label: 'E',
          description: 'E.',
          method: 'GET',
          path: '/e',
          records: '$',
          cost: { perCall: 0, perRecord: 0, unit: 'calls' },
          free: true,
        },
      ],
      channels: [{ id: 'ch', title: 'Ch', controls: [c] }],
      notes: [],
      run: { mode: 'single', endpointId: 'e' },
    });
    k.expect(new URL(buildRequest(s, 'e', { c: k.value }).url).searchParams);
    expect(isChanged(c, k.value)).toBe(true);
  });
});

describe('the seed specs’ controls', () => {
  it('start from their defaults, unchanged, and every default passes', () => {
    for (const input of [coresignalJson, hackerNewsJson, openMeteoJson])
      for (const c of allControls(spec(input))) {
        expect(valueProblem(c, startValue(c))).toBeNull();
        expect(isChanged(c, startValue(c))).toBe(false);
      }
  });
});
