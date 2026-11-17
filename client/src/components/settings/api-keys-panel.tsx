'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/components/auth/api';
import { Button, Dialog, Field, Input, Monogram, toast } from '@/components/ui';
import type { ApiKey } from '@/contracts/api-keys';

/**
 * API keys: chat F's vault, as Settings shows it. Each key with its ending, the projects using it and the
 * credits left when the API reports them, with Test and Replace; APIs that need no key list their projects.
 */
export type ApiKeyRow = ApiKey & { projects: number; monogram: string };
export type KeylessApi = { apiSlug: string; apiName: string; monogram: string; projects: number };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ApiKeysPanel({ initial, keyless }: { initial: ApiKeyRow[]; keyless: KeylessApi[] }) {
  const [keys, setKeys] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState<ApiKeyRow | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const reload = async () => {
    const res = await api<{ keys: ApiKeyRow[] }>('/api/api-keys');
    if (res.ok) setKeys(res.data.keys);
  };
  const test = async (key: ApiKeyRow) => {
    setTesting(key.id);
    const res = await api<{ ok: boolean; message: string }>(`/api/api-keys/${key.id}/test`, {});
    setTesting(null);
    if (!res.ok) return toast.error(res.error.message);
    if (res.data.ok) toast.success(res.data.message);
    else toast.error(res.data.message);
    void reload();
  };

  return (
    <section className="panel" aria-labelledby="h-keys">
      <div className="panel-head">
        <h2 className="panel-title grow" id="h-keys">
          API keys
        </h2>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="i i-sm" aria-hidden="true" />
          Add
        </Button>
      </div>
      <div className="krows">
        {keys.map((key, i) => (
          <div className="krow" key={key.id}>
            <Monogram text={key.monogram} size="sm" tone={i === 0 ? 'signal' : 'default'} />
            <div className="grow">
              <div className="krow-title">
                {key.apiName}
                {key.label ? ` · ${key.label}` : ''}
                {key.lastTestOk !== null && <span className={key.lastTestOk ? 'led' : 'led is-err'} />}
              </div>
              <p className="krow-sub">
                Key ending {key.last4} · {plural(key.projects, 'project')}
                {key.creditsLeft !== null ? ` · ${key.creditsLeft.toLocaleString('en')} credits left` : ''}
              </p>
            </div>
            <div className="krow-acts">
              <Button size="sm" onClick={() => test(key)} busy={testing === key.id}>
                Test
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReplacing(key)}>
                Replace
              </Button>
            </div>
          </div>
        ))}
        {keyless.map((k) => (
          <div className="krow" key={k.apiSlug}>
            <Monogram text={k.monogram} size="sm" />
            <div className="grow">
              <div className="krow-title">{k.apiName}</div>
              <p className="krow-sub">No key needed · {plural(k.projects, 'project')}</p>
            </div>
            <div className="krow-acts" />
          </div>
        ))}
        {!keys.length && !keyless.length && (
          <div className="krow">
            <div className="grow">
              <p className="krow-sub">No API keys yet. New project saves one when the API needs it.</p>
            </div>
          </div>
        )}
      </div>
      <p className="hint">Keys are encrypted. Only your own runs can use them.</p>

      {adding && (
        <AddKey
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void reload();
          }}
        />
      )}
      {replacing && (
        <ReplaceKey
          apiKey={replacing}
          onClose={() => setReplacing(null)}
          onDone={() => {
            setReplacing(null);
            void reload();
          }}
        />
      )}
    </section>
  );
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'api';

function AddKey({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await api('/api/api-keys', { apiSlug: slugOf(name), apiName: name, host, secret });
    setBusy(false);
    if (!res.ok) {
      setProblems(Object.fromEntries((res.error.problems ?? []).map((p) => [p.path, p.message])));
      return setError(res.error.problems?.length ? null : res.error.message);
    }
    toast.success(`Saved the ${name} key.`);
    onSaved();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add an API key"
      description="The key is sent only to the address you give here, and only for your own runs."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} busy={busy}>
            Save key
          </Button>
        </>
      }
    >
      <Field label="API" error={problems.apiName ?? null}>
        {({ id, invalid }) => (
          <Input
            id={id}
            value={name}
            invalid={invalid}
            placeholder="CoreSignal"
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label="Its address" hint="Where the key is sent, like api.coresignal.com." error={problems.host ?? null}>
        {({ id, invalid, describedBy }) => (
          <Input
            id={id}
            value={host}
            invalid={invalid}
            aria-describedby={describedBy}
            placeholder="api.example.com"
            onChange={(e) => setHost(e.target.value)}
          />
        )}
      </Field>
      <Field label="Key" error={problems.secret ?? error}>
        {({ id, invalid }) => (
          <Input
            id={id}
            type="password"
            autoComplete="off"
            value={secret}
            invalid={invalid}
            onChange={(e) => setSecret(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

function ReplaceKey({ apiKey, onClose, onDone }: { apiKey: ApiKeyRow; onClose: () => void; onDone: () => void }) {
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const save = async () => {
    setBusy('save');
    const res = await api(`/api/api-keys/${apiKey.id}`, { secret }, { method: 'PUT' });
    setBusy(null);
    if (!res.ok) return setError(res.error.message);
    toast.success(`Replaced the ${apiKey.apiName} key.`);
    onDone();
  };
  const remove = async () => {
    setBusy('remove');
    const res = await api(`/api/api-keys/${apiKey.id}`, undefined, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) return setError(res.error.message);
    toast.success(`Removed the ${apiKey.apiName} key.`);
    onDone();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Replace the ${apiKey.apiName} key`}
      description={`It stays saved for ${apiKey.host}, so ${plural(apiKey.projects, 'project')} keep using it.`}
      actions={
        confirmRemove ? (
          <>
            <span className="hint grow">
              Remove it? {apiKey.projects ? `${plural(apiKey.projects, 'project')} will need a new key.` : ''}
            </span>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={remove} busy={busy === 'remove'}>
              Remove
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
              Remove key
            </Button>
            <span className="grow" />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} busy={busy === 'save'} disabled={secret.trim().length < 8}>
              Replace
            </Button>
          </>
        )
      }
    >
      <Field label="New key" error={error}>
        {({ id, invalid }) => (
          <Input
            id={id}
            type="password"
            autoComplete="off"
            value={secret}
            invalid={invalid}
            onChange={(e) => setSecret(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}
