'use client';

import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/components/auth/api';
import { Button, Chip, Input, Monogram, Select, type Option } from '@/components/ui';
import {
  AI_KEY_HINTS,
  AI_PROVIDER_LABELS,
  AI_PROVIDER_TILES,
  AI_PROVIDERS,
  type AiKey,
  type AiModelOption,
  type AiProvider,
  type AiTestResult,
} from '@/contracts/ai';

/**
 * Paste an AI key (screen 02, and Add key in Settings): the provider tiles, the key with where to find it, the
 * model from the provider's live list, and Test, which saves the key and sends one tiny message.
 */
export function KeyForm({
  initialProvider = 'anthropic',
  onSaved,
  idPrefix = 'ai',
}: {
  initialProvider?: AiProvider;
  onSaved?: (key: AiKey, result: AiTestResult) => void;
  idPrefix?: string;
}) {
  const [provider, setProvider] = useState<AiProvider>(initialProvider);
  const [secret, setSecret] = useState('');
  const [shown, setShown] = useState(false);
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const asked = useRef('');

  // The live model list, once the key looks whole.
  useEffect(() => {
    const key = secret.trim();
    if (key.length < 20) return;
    const ask = `${provider}:${key}`;
    const timer = setTimeout(async () => {
      asked.current = ask;
      setLoading(true);
      const res = await api<{ models: AiModelOption[]; recommended: string }>('/api/ai/models', {
        provider,
        secret: key,
      });
      if (asked.current !== ask) return;
      setLoading(false);
      if (res.ok) {
        setModels(res.data.models);
        setModel(res.data.recommended);
        setError(null);
      } else {
        setModels([]);
        setModel(null);
        setError(res.error.message);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [provider, secret]);

  const pick = (next: AiProvider) => {
    setProvider(next);
    setModels([]);
    setModel(null);
    setError(null);
    setResult(null);
  };

  const options: Option[] = models.map((m) => ({
    value: m.id,
    label: m.name,
    end: m.recommended ? (
      <Chip tone="soft" style={{ height: 22, fontSize: 12 }}>
        Recommended
      </Chip>
    ) : undefined,
  }));

  const test = async () => {
    setBusy(true);
    setResult(null);
    const saved = await api<{ key: AiKey }>('/api/ai/keys', {
      provider,
      secret: secret.trim(),
      model: model ?? undefined,
    });
    if (!saved.ok) {
      setBusy(false);
      setError(saved.error.message);
      return;
    }
    const tested = await api<{ result: AiTestResult }>(`/api/ai/keys/${saved.data.key.id}/test`, {});
    setBusy(false);
    const outcome = tested.ok ? tested.data.result : { ok: false, ms: 0, message: tested.error.message };
    setResult(outcome);
    setSecret('');
    onSaved?.(saved.data.key, outcome);
  };

  const keyId = `${idPrefix}-key`;
  return (
    <>
      <div className="field">
        <span className="label">Provider</span>
        <div className="providers" role="group" aria-label="AI provider">
          {AI_PROVIDERS.map((p) => (
            <button key={p} className="provider" type="button" aria-pressed={provider === p} onClick={() => pick(p)}>
              <Monogram text={AI_PROVIDER_TILES[p].mono} size="sm" tone={provider === p ? 'ink' : 'default'} />
              <span>
                {AI_PROVIDER_TILES[p].name}
                <small>{AI_PROVIDER_TILES[p].small}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor={keyId}>
          {AI_PROVIDER_LABELS[provider]} API key
        </label>
        <Input
          id={keyId}
          large
          type={shown ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={secret}
          invalid={Boolean(error)}
          placeholder="Paste your key"
          onChange={(e) => {
            setSecret(e.target.value);
            setResult(null);
          }}
          end={
            <button
              className="btn btn-sm btn-icon btn-ghost"
              type="button"
              aria-label={shown ? 'Hide key' : 'Show key'}
              aria-pressed={shown}
              onClick={() => setShown((s) => !s)}
            >
              {shown ? <EyeOff className="i" aria-hidden="true" /> : <Eye className="i" aria-hidden="true" />}
            </button>
          }
        />
        {error ? (
          <p className="err-text" role="alert">
            <AlertCircle className="i i-sm" aria-hidden="true" />
            {error}
          </p>
        ) : (
          <p className="hint">{AI_KEY_HINTS[provider]} It’s encrypted and only used for your requests.</p>
        )}
      </div>
      <div className="field">
        <span className="label" id={`${idPrefix}-model-label`}>
          Model
        </span>
        <Select
          key={model ? 'picked' : 'empty'}
          options={options}
          value={model}
          onChange={setModel}
          label="Model"
          disabled={!models.length}
          placeholder={loading ? 'Reading the models…' : 'Paste the key to see its models'}
        />
      </div>
      {result ? (
        <div className={result.ok ? 'ok-line' : 'ok-line is-err'} role="status">
          {result.ok ? (
            <CheckCircle2 className="i" aria-hidden="true" />
          ) : (
            <AlertCircle className="i" aria-hidden="true" />
          )}
          {result.message}
        </div>
      ) : (
        <div className="row">
          <Button type="button" onClick={test} busy={busy} disabled={!model || busy || secret.trim().length < 12}>
            Test and save
          </Button>
        </div>
      )}
    </>
  );
}
