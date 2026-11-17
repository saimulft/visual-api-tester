'use client';

import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  ListFilter,
  Lock,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/components/auth/api';
import { Button, ButtonLink, Input, Monogram, Switch, Textarea } from '@/components/ui';
import type { AiSummary } from '@/contracts/ai';
import type { ApiKey } from '@/contracts/api-keys';
import type { ApiListing, DocsProbe, FoundApi } from '@/contracts/discovery';
import { useMcpStatus, type McpStatusView } from '../onboarding/use-mcp-status';
import { DetailHead } from './detail-head';

/**
 * Screen 04, New project: which API (search, the docs found, or another link), its key (saved to the vault for
 * the API's host, with a free test first), the brief with suggestion chips, and who does the setup. The side
 * panel says what the AI will do, with the counts discovery found.
 */
type KeyTestResult = { ok: boolean; message: string; tested: boolean };

/** A short project name from the brief: "Company search for Australian software companies". */
export function nameFromBrief(brief: string, fallback: string): string {
  let text = brief
    .trim()
    .split(/[.;!?\n]/)[0]
    .replace(/^(please\s+)?(set up|setup|build|make|create|i want( to)?|i need( to)?|get|show me|pull|track)\s+/i, '')
    .split(/,| and | so | because /)[0]
    .trim();
  if (text.length > 40) text = text.split(/ (with|that|where|from|in|for the|using) /)[0];
  if (text.length > 48) text = text.slice(0, 48).replace(/\s+\S*$/, '');
  text = text.replace(/[\s,:-]+$/, '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : fallback;
}

export function NewProject({
  emailChecked,
  ai,
  mcp,
  savedKeys,
  generalBriefs,
}: {
  emailChecked: boolean;
  ai: AiSummary;
  mcp: McpStatusView;
  savedKeys: ApiKey[];
  generalBriefs: string[];
}) {
  const router = useRouter();
  const status = useMcpStatus(mcp);

  // Which API?
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ApiListing[]>([]);
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<FoundApi | null>(null);
  const [probing, setProbing] = useState(false);
  const [otherLink, setOtherLink] = useState(false);
  const [link, setLink] = useState('');
  const [findError, setFindError] = useState<string | null>(null);
  const asked = useRef('');

  // The key.
  const [secret, setSecret] = useState('');
  const [shown, setShown] = useState(false);
  const [testFirst, setTestFirst] = useState(true);
  const [keyResult, setKeyResult] = useState<KeyTestResult | null>(null);
  const [useSaved, setUseSaved] = useState(true);
  const [keyHost, setKeyHost] = useState('');

  // The brief and who.
  const [brief, setBrief] = useState('');
  const [via, setVia] = useState<'builtin' | 'mcp'>(mcp.connected || !ai.keys ? 'mcp' : 'builtin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listing = found?.listing ?? null;
  const probe: DocsProbe | null = found?.probe ?? null;
  const saved = listing
    ? savedKeys.find((k) => k.apiSlug === listing.slug && (!listing.apiHost || k.host === listing.apiHost))
    : undefined;
  const needsKey = listing ? listing.key.in === 'header' || listing.key.in === 'query' : false;
  const mayNeedKey = listing?.key.in === 'unknown';

  const choose = async (picked: ApiListing, url = picked.docsUrl) => {
    setFound({ listing: picked, probe: null });
    setResults([]);
    setFindError(null);
    setProbing(true);
    const res = await api<FoundApi>('/api/discovery/probe', {
      url,
      slug: picked.source === 'link' ? undefined : picked.slug,
    });
    setProbing(false);
    if (res.ok) setFound(res.data);
    else setFindError(res.error.message);
  };

  // Search as the person types.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || (found && found.listing.name === q)) return;
    const timer = setTimeout(async () => {
      asked.current = q;
      setSearching(true);
      const res = await api<{ results: ApiListing[] }>(`/api/discovery?q=${encodeURIComponent(q)}`);
      if (asked.current !== q) return;
      setSearching(false);
      if (!res.ok) return setFindError(res.error.message);
      setResults(res.data.results);
      if (!res.data.results.length) setFindError(`No docs found for “${q}”. Paste the docs link instead.`);
      else setFindError(null);
    }, 350);
    return () => clearTimeout(timer);
  }, [query, found]);

  const keyHint = listing?.keyHint ?? (listing ? `Find it in your ${listing.name} account.` : '');
  const briefs = listing?.briefs.length ? listing.briefs : generalBriefs;
  const canBuiltin = ai.keys > 0;
  const missing = !emailChecked
    ? {
        text: 'Check your email first: anything that calls an API or an AI needs it.',
        href: '/check-email',
        cta: 'Check your email',
      }
    : !canBuiltin && !status.connected
      ? {
          text: 'Connect an AI first: paste an AI key, or connect your own AI over MCP.',
          href: '/welcome/ai',
          cta: 'Connect your AI',
        }
      : null;

  const submit = async () => {
    setError(null);
    if (!listing) return setError('Pick the API first.');
    if (brief.trim().length < 10) return setError('Tell the AI what you want, in a sentence or two.');
    if (via === 'builtin' && !canBuiltin) return setError('Add an AI key first, or pick your own AI over MCP.');
    const keyToSave = needsKey || mayNeedKey ? secret.trim() : '';
    if (needsKey && !(saved && useSaved) && !keyToSave) return setError(`Paste your ${listing.name} API key.`);
    setBusy(true);
    if (keyToSave && testFirst && listing.keyTest) {
      const test = await api<{ result: KeyTestResult }>('/api/discovery/key-test', {
        slug: listing.slug,
        secret: keyToSave,
      });
      const result = test.ok ? test.data.result : { ok: false, message: test.error.message, tested: true };
      setKeyResult(result);
      if (!result.ok) return setBusy(false);
    }
    const host = listing.apiHost ?? (keyHost.trim() || null);
    if (keyToSave && !host) {
      setBusy(false);
      return setError('Say where the key is sent: the API’s address, like api.example.com.');
    }
    const res = await api<{ projectId: string; setupId: string }>('/api/setup', {
      name: nameFromBrief(brief, listing.name),
      apiName: listing.name,
      apiSlug: listing.slug,
      monogram: listing.monogram,
      docsUrl: probe?.docsUrl ?? listing.docsUrl,
      docsEndpoints: probe?.endpoints ?? null,
      brief: brief.trim(),
      via,
      ...(saved && useSaved && !keyToSave
        ? { apiKeyId: saved.id }
        : keyToSave && host
          ? { apiKey: { host, secret: keyToSave } }
          : {}),
    });
    if (!res.ok) {
      setBusy(false);
      return setError(res.error.message);
    }
    router.push(`/projects/${res.data.projectId}/setup`);
  };

  const docsHost = probe?.docsHost ?? (listing ? hostOf(listing.docsUrl) : null);
  const pagesLine = probe?.pages
    ? probe.pages > 25
      ? `Up to 25 pages from ${docsHost}`
      : `About ${probe.pages} pages from ${docsHost}`
    : docsHost
      ? `The pages it needs from ${docsHost}`
      : 'The pages your brief needs';

  return (
    <>
      <DetailHead
        crumbs={[{ label: 'Projects', href: '/projects' }, { label: 'New' }]}
        title="New project"
        actions={
          <Link className="btn btn-sm btn-ghost" href="/projects">
            Cancel
          </Link>
        }
      />
      <div className="page">
        <div className="page-in">
          <div className="np">
            <form
              className="np-form"
              aria-label="Set up a new project"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {missing && (
                <div className="ok-line is-err" role="status">
                  <AlertCircle className="i" aria-hidden="true" />
                  <span className="grow">{missing.text}</span>
                  <Link className="btn btn-sm" href={missing.href}>
                    {missing.cta}
                  </Link>
                </div>
              )}

              <div className="q">
                <label className="q-label" htmlFor="np-api">
                  Which API?
                </label>
                {otherLink ? (
                  <Input
                    id="np-api"
                    large
                    icon={<BookOpen className="i" aria-hidden="true" />}
                    type="url"
                    placeholder="https://docs.example.com"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (/^https?:\/\//.test(link.trim()))
                          void choose(
                            {
                              slug: '',
                              name: hostOf(link.trim()) ?? link,
                              monogram: '',
                              docsUrl: link.trim(),
                              openApiUrl: null,
                              apiHost: null,
                              topic: null,
                              key: { in: 'unknown' },
                              keyHint: null,
                              keyTest: null,
                              costNote: null,
                              briefs: [],
                              source: 'link',
                            },
                            link.trim(),
                          );
                      }
                    }}
                    end={
                      <Button
                        size="sm"
                        type="button"
                        onClick={() => {
                          setOtherLink(false);
                          setLink('');
                        }}
                      >
                        Search instead
                      </Button>
                    }
                  />
                ) : (
                  <Input
                    id="np-api"
                    large
                    icon={<Search className="i" aria-hidden="true" />}
                    placeholder="CoreSignal, Open-Meteo, Hacker News…"
                    autoComplete="off"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setFound(null);
                      setKeyResult(null);
                    }}
                    end={searching ? <span className="spin dark" aria-hidden="true" /> : undefined}
                  />
                )}
                {results.length > 0 && !found && (
                  <div className="chips" role="group" aria-label="APIs found">
                    {results.map((r) => (
                      <button
                        key={`${r.source}-${r.slug}`}
                        className="chip"
                        type="button"
                        onClick={() => void choose(r)}
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
                {listing && (
                  <div className="found" aria-live="polite">
                    <Monogram text={listing.monogram || listing.name.slice(0, 2)} size="sm" tone="signal" />
                    <div className="grow">
                      {probing ? (
                        <>
                          <strong>Reading the {listing.name} docs</strong>
                          <br />
                          {docsHost}
                        </>
                      ) : (
                        <>
                          <strong>Found the {listing.name} docs</strong>
                          <br />
                          {probe?.summary ?? docsHost}
                        </>
                      )}
                    </div>
                    <a
                      href="#np-api"
                      onClick={(e) => {
                        e.preventDefault();
                        setOtherLink(true);
                        setLink(listing.docsUrl);
                      }}
                    >
                      Use another link
                    </a>
                  </div>
                )}
                {!listing && !otherLink && (
                  <p className="hint">
                    Type the API’s name, or{' '}
                    <a
                      href="#np-api"
                      onClick={(e) => {
                        e.preventDefault();
                        setOtherLink(true);
                      }}
                    >
                      paste its docs link
                    </a>
                    .
                  </p>
                )}
                {findError && (
                  <p className="err-text" role="alert">
                    <AlertCircle className="i i-sm" aria-hidden="true" />
                    {findError}
                  </p>
                )}
              </div>

              {listing && (needsKey || mayNeedKey) && (
                <div className="q">
                  <label className="q-label" htmlFor="np-key">
                    {mayNeedKey ? `Your ${listing.name} API key, if it needs one` : `Your ${listing.name} API key`}
                  </label>
                  {saved && useSaved ? (
                    <div className="found">
                      <Lock className="i" aria-hidden="true" />
                      <div className="grow">
                        <strong>Your saved key ending {saved.last4}</strong>
                        <br />
                        Saved for {saved.host}
                      </div>
                      <a
                        href="#np-key"
                        onClick={(e) => {
                          e.preventDefault();
                          setUseSaved(false);
                        }}
                      >
                        Use another key
                      </a>
                    </div>
                  ) : (
                    <>
                      <Input
                        id="np-key"
                        large
                        icon={<Lock className="i" aria-hidden="true" />}
                        type={shown ? 'text' : 'password'}
                        autoComplete="off"
                        spellCheck={false}
                        value={secret}
                        invalid={keyResult ? !keyResult.ok : false}
                        onChange={(e) => {
                          setSecret(e.target.value);
                          setKeyResult(null);
                        }}
                        end={
                          <button
                            className="btn btn-sm btn-icon btn-ghost"
                            type="button"
                            aria-label={shown ? 'Hide key' : 'Show key'}
                            aria-pressed={shown}
                            onClick={() => setShown((s) => !s)}
                          >
                            {shown ? (
                              <EyeOff className="i" aria-hidden="true" />
                            ) : (
                              <Eye className="i" aria-hidden="true" />
                            )}
                          </button>
                        }
                      />
                      {!listing.apiHost && secret.trim() && (
                        <Input
                          aria-label="Where the key is sent"
                          placeholder="Where the key is sent, like api.example.com"
                          value={keyHost}
                          onChange={(e) => setKeyHost(e.target.value)}
                        />
                      )}
                      {listing.keyTest ? (
                        <Switch
                          checked={testFirst}
                          onChange={setTestFirst}
                          label="Test the key first"
                          text={`Test it with one free search before saving. ${keyHint}`}
                        />
                      ) : (
                        <p className="hint">
                          {keyHint} {needsKey ? 'The AI’s test call checks it.' : ''} It’s saved for this API’s address
                          only.
                        </p>
                      )}
                    </>
                  )}
                  {keyResult && (
                    <div className={keyResult.ok ? 'ok-line' : 'ok-line is-err'} role="status">
                      {keyResult.ok ? (
                        <CheckCircle2 className="i" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="i" aria-hidden="true" />
                      )}
                      {keyResult.message}
                    </div>
                  )}
                </div>
              )}

              <div className="q">
                <label className="q-label" htmlFor="np-brief">
                  Tell the AI what you want
                </label>
                <Textarea
                  id="np-brief"
                  value={brief}
                  placeholder="Say what you want to see, which places, sizes or dates matter, and how often you need it."
                  onChange={(e) => setBrief(e.target.value)}
                />
                <div className="chips">
                  <span className="hint">Or start from</span>
                  {briefs.map((b) => (
                    <button key={b} className="chip" type="button" onClick={() => setBrief(b)}>
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              <div className="q">
                <span className="q-label">Who does the setup?</span>
                <div className="choices">
                  <button className="choice" type="button" aria-pressed={via === 'mcp'} onClick={() => setVia('mcp')}>
                    <span className="radio" />
                    <span>
                      <strong>
                        {status.connected
                          ? `${status.clientName ?? 'Your AI'}, through MCP`
                          : 'Your own AI, through MCP'}
                      </strong>
                      <span className="hint">
                        {status.connected
                          ? `${status.clientName ?? 'Your AI'} is connected. You’ll watch it work here.`
                          : 'Not connected yet. The setup waits until you ask your AI to start.'}
                      </span>
                    </span>
                  </button>
                  <button
                    className="choice"
                    type="button"
                    aria-pressed={via === 'builtin'}
                    onClick={() => setVia('builtin')}
                  >
                    <span className="radio" />
                    <span>
                      <strong>Built-in assistant</strong>
                      <span className="hint">
                        {canBuiltin
                          ? `Uses your ${providerName(ai.provider)} key with ${ai.modelName}.`
                          : 'Add an AI key in Settings to use it.'}
                      </span>
                    </span>
                  </button>
                </div>
              </div>

              {error && (
                <div className="ok-line is-err" role="alert">
                  <AlertCircle className="i" aria-hidden="true" />
                  {error}
                </div>
              )}

              <div className="np-actions">
                <span className="hint">{listing?.costNote ?? 'Nothing is spent until you run a request.'}</span>
                <Link className="btn btn-ghost" href="/projects">
                  Cancel
                </Link>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  busy={busy}
                  disabled={busy || Boolean(missing)}
                  tile={<Sparkles className="i" aria-hidden="true" />}
                >
                  Set up project
                </Button>
              </div>
            </form>

            <aside className="np-side" aria-label="What happens next">
              <section className="panel">
                <div className="panel-head">
                  <span className="micro">What the AI will do</span>
                </div>
                <ol className="plan">
                  <li>
                    <span className="mtile">
                      <BookOpen className="i" aria-hidden="true" />
                    </span>
                    <span>
                      <strong>Read the docs</strong>
                      <span className="hint">{pagesLine}</span>
                    </span>
                  </li>
                  <li>
                    <span className="mtile">
                      <ListFilter className="i" aria-hidden="true" />
                    </span>
                    <span>
                      <strong>Pick what fits</strong>
                      <span className="hint">
                        {probe?.endpoints
                          ? `Only the endpoints that match your brief, of ${probe.endpoints.toLocaleString('en')}`
                          : 'Only the endpoints that match your brief'}
                      </span>
                    </span>
                  </li>
                  <li>
                    <span className="mtile is-signal">
                      <SlidersHorizontal className="i" aria-hidden="true" />
                    </span>
                    <span>
                      <strong>Build your controls</strong>
                      <span className="hint">Sliders, switches and lists, with notes on any limits</span>
                    </span>
                  </li>
                  <li>
                    <span className="mtile">
                      <CheckCircle2 className="i" aria-hidden="true" />
                    </span>
                    <span>
                      <strong>Test one call</strong>
                      <span className="hint">
                        {needsKey
                          ? 'A free search with your key, so you know it works'
                          : 'A free call, so you know it works'}
                      </span>
                    </span>
                  </li>
                </ol>
              </section>
              <section className="ai-card">
                <div className="row" style={{ gap: 8, fontWeight: 600 }}>
                  <Sparkles className="i i-sm" aria-hidden="true" />
                  Tips for a good brief
                </div>
                <p>
                  Say what you want to see, which places, sizes or dates matter, and how often you need it. You can ask
                  for changes later.
                </p>
              </section>
              {!canBuiltin && !status.connected && (
                <ButtonLink href="/welcome/ai" size="sm">
                  Connect your AI
                </ButtonLink>
              )}
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function providerName(provider: AiSummary['provider']) {
  return provider === 'anthropic'
    ? 'Anthropic'
    : provider === 'openai'
      ? 'OpenAI'
      : provider === 'gemini'
        ? 'Google Gemini'
        : provider === 'openrouter'
          ? 'OpenRouter'
          : 'AI';
}
