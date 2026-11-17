'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/components/auth/api';
import { Button, Chip, Dialog, Field, Input, Monogram, Select, toast, type Option } from '@/components/ui';
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDER_TILES,
  AI_PROVIDERS,
  type AiKey,
  type AiModelOption,
  type AiProvider,
  type AiTestResult,
} from '@/contracts/ai';
import { KeyForm } from '../onboarding/key-form';

/**
 * Built-in assistant, "Tried from the top": the person's AI keys in the order they're tried. Drag a row (or
 * use the arrows) to reorder; Test sends one tiny message; Edit changes the model, label or key; providers
 * without a key offer Add key.
 */
export function AiKeysPanel({ initial }: { initial: AiKey[] }) {
  const router = useRouter();
  const [keys, setKeys] = useState(initial);
  const [adding, setAdding] = useState<AiProvider | null>(null);
  const [editing, setEditing] = useState<AiKey | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const save = async (next: AiKey[]) => {
    const before = keys;
    setKeys(next);
    const res = await api<{ keys: AiKey[] }>('/api/ai/keys/order', { ids: next.map((k) => k.id) }, { method: 'PUT' });
    if (res.ok) setKeys(res.data.keys);
    else {
      setKeys(before);
      toast.error(res.error.message);
    }
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= keys.length) return;
    void save(arrayMove(keys, from, to));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = keys.findIndex((k) => k.id === e.active.id);
    const to = keys.findIndex((k) => k.id === e.over!.id);
    void save(arrayMove(keys, from, to));
  };
  const test = async (key: AiKey) => {
    setTesting(key.id);
    const res = await api<{ result: AiTestResult }>(`/api/ai/keys/${key.id}/test`, {});
    setTesting(null);
    const result = res.ok ? res.data.result : { ok: false, message: res.error.message };
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  };
  const refresh = async () => {
    const res = await api<{ keys: AiKey[] }>('/api/ai/keys');
    if (res.ok) setKeys(res.data.keys);
    router.refresh();
  };

  const missing = AI_PROVIDERS.filter((p) => !keys.some((k) => k.provider === p));

  return (
    <section className="panel" aria-labelledby="h-assistant">
      <div className="panel-head">
        <h2 className="panel-title grow" id="h-assistant">
          Built-in assistant
        </h2>
        <Chip tone="soft">Tried from the top</Chip>
      </div>
      <div className="krows">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={keys.map((k) => k.id)} strategy={verticalListSortingStrategy}>
            {keys.map((key, i) => (
              <KeyRow
                key={key.id}
                aiKey={key}
                first={i === 0}
                busy={testing === key.id}
                onTest={() => test(key)}
                onEdit={() => setEditing(key)}
                onUp={i > 0 ? () => move(i, i - 1) : undefined}
                onDown={i < keys.length - 1 ? () => move(i, i + 1) : undefined}
              />
            ))}
          </SortableContext>
        </DndContext>
        {missing.map((p) => (
          <div className="krow" key={p}>
            <span className="krow-lead">
              <span className="handle" aria-hidden="true">
                <GripVertical className="i i-sm" />
              </span>
              <Monogram text={AI_PROVIDER_TILES[p].mono} size="sm" />
            </span>
            <div className="grow">
              <div className="krow-title">{AI_PROVIDER_LABELS[p]}</div>
              <p className="krow-sub">No key yet</p>
            </div>
            <div className="krow-acts">
              <Button size="sm" onClick={() => setAdding(p)}>
                <Plus className="i i-sm" aria-hidden="true" />
                Add key
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        title="Add an AI key"
        description="It goes at the bottom of the list, tried after the keys above it."
        size="lg"
      >
        {adding && (
          <div className="col" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <KeyForm
              key={adding}
              idPrefix="add"
              initialProvider={adding}
              onSaved={() => {
                void refresh();
              }}
            />
          </div>
        )}
      </Dialog>
      {editing && (
        <EditKey
          aiKey={editing}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}

function KeyRow({
  aiKey,
  first,
  busy,
  onTest,
  onEdit,
  onUp,
  onDown,
}: {
  aiKey: AiKey;
  first: boolean;
  busy: boolean;
  onTest: () => void;
  onEdit: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: aiKey.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative' as const,
    zIndex: isDragging ? 2 : undefined,
    background: isDragging ? '#fff' : undefined,
  };
  return (
    <div className="krow" ref={setNodeRef} style={style}>
      <span className="krow-lead">
        <button
          className="handle"
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Move the ${AI_PROVIDER_LABELS[aiKey.provider]} key`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="i i-sm" aria-hidden="true" />
        </button>
        <Monogram text={AI_PROVIDER_TILES[aiKey.provider].mono} size="sm" tone={first ? 'ink' : 'default'} />
      </span>
      <div className="grow">
        <div className="krow-title">
          {AI_PROVIDER_LABELS[aiKey.provider]}
          {aiKey.label ? ` · ${aiKey.label}` : ''}
          {first && (
            <Chip tone="on" style={{ height: 22, fontSize: 12 }}>
              First
            </Chip>
          )}
        </div>
        <p className="krow-sub">
          {aiKey.modelName} · key ending {aiKey.last4} · used for {aiKey.setups} setup{aiKey.setups === 1 ? '' : 's'}
          {aiKey.lastTestOk === false ? ' · last test failed' : ''}
        </p>
      </div>
      <div className="krow-acts">
        <Button size="sm" variant="ghost" icon aria-label="Move up" onClick={onUp} disabled={!onUp}>
          <ArrowUp className="i i-sm" aria-hidden="true" />
        </Button>
        <Button size="sm" variant="ghost" icon aria-label="Move down" onClick={onDown} disabled={!onDown}>
          <ArrowDown className="i i-sm" aria-hidden="true" />
        </Button>
        <Button size="sm" onClick={onTest} busy={busy}>
          Test
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

function EditKey({ aiKey, onClose, onChanged }: { aiKey: AiKey; onClose: () => void; onChanged: () => void }) {
  const [models, setModels] = useState<AiModelOption[] | null>(null);
  const [model, setModel] = useState<string>(aiKey.model);
  const [label, setLabel] = useState(aiKey.label);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (models === null) {
    setModels([]);
    void api<{ models: AiModelOption[] }>('/api/ai/models', { keyId: aiKey.id }).then((res) =>
      setModels(res.ok ? res.data.models : [{ id: aiKey.model, name: aiKey.modelName }]),
    );
  }
  const options: Option[] = (models?.length ? models : [{ id: aiKey.model, name: aiKey.modelName }]).map((m) => ({
    value: m.id,
    label: m.name,
  }));

  const save = async () => {
    setBusy('save');
    setError(null);
    const res = await api(
      `/api/ai/keys/${aiKey.id}`,
      { model, label, ...(secret.trim() ? { secret: secret.trim() } : {}) },
      { method: 'PATCH' },
    );
    setBusy(null);
    if (!res.ok) return setError(res.error.message);
    toast.success('Saved.');
    onChanged();
  };
  const remove = async () => {
    setBusy('remove');
    const res = await api(`/api/ai/keys/${aiKey.id}`, undefined, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) return setError(res.error.message);
    toast.success(`Removed the ${AI_PROVIDER_LABELS[aiKey.provider]} key.`);
    onChanged();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${AI_PROVIDER_LABELS[aiKey.provider]} key ending ${aiKey.last4}`}
      description="Change the model it uses, its label, or paste a new key in its place."
      actions={
        confirmRemove ? (
          <>
            <span className="hint grow">Remove this key? Setups that used it keep their history.</span>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={remove} busy={busy === 'remove'}>
              Remove
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="grow-0" onClick={() => setConfirmRemove(true)}>
              Remove key
            </Button>
            <span className="grow" />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} busy={busy === 'save'}>
              Save
            </Button>
          </>
        )
      }
    >
      <div className="field">
        <span className="label">Model</span>
        <Select options={options} value={model} onChange={setModel} label="Model" />
      </div>
      <Field label="Label" hint="Optional, like “Work account”.">
        {({ id }) => <Input id={id} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />}
      </Field>
      <Field
        label="New key"
        hint="Leave empty to keep the current key. A new key is checked before it’s saved."
        error={error}
      >
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
