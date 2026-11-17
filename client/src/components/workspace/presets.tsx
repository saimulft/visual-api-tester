'use client';

import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/components/auth/api';
import { Button, Dialog, Field, Input, Menu, toast } from '@/components/ui';
import type { Values } from '@/contracts/spec';
import { sameValue } from '@/contracts/values';
import type { Preset } from '@/contracts/workspace';
import { dateText } from './format';

/** The side panel's saved presets: apply one in a click; rename, update or delete it from its menu. */
export function PresetList({
  presets,
  activeId,
  onApply,
  onChange,
  currentValues,
}: {
  presets: Preset[];
  values: Values;
  activeId: string | null;
  onApply: (preset: Preset) => void;
  onChange: (presets: Preset[]) => void;
  currentValues: Values;
}) {
  const [renaming, setRenaming] = useState<Preset | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<Preset | null>(null);

  const matches = (preset: Preset) =>
    Object.entries(preset.values).every(([id, value]) => sameValue(value, currentValues[id]));

  const patch = async (preset: Preset, body: { name?: string; values?: Values }, done: string) => {
    const res = await api<{ preset: Preset }>(`/api/presets/${preset.id}`, body, { method: 'PATCH' });
    if (!res.ok) return toast.error(res.error.message);
    onChange(presets.map((p) => (p.id === preset.id ? res.data.preset : p)));
    toast.success(done);
  };

  const remove = async (preset: Preset) => {
    const res = await api(`/api/presets/${preset.id}`, undefined, { method: 'DELETE' });
    if (!res.ok) return toast.error(res.error.message);
    onChange(presets.filter((p) => p.id !== preset.id));
    setDeleting(null);
    toast.success(`Deleted “${preset.name}”`);
  };

  return (
    <div className="presets">
      <p className="micro side-label">Saved presets</p>
      {presets.length === 0 && <p className="hint">Save the controls as a preset to come back to them, or to run them on a schedule.</p>}
      {presets.map((preset) => {
        const on = activeId === preset.id || (activeId === null && matches(preset));
        return (
          <div key={preset.id} className="row" style={{ gap: 2 }}>
            <button className={on ? 'preset is-on' : 'preset'} type="button" onClick={() => onApply(preset)} aria-pressed={on}>
              <span className={on ? 'led' : 'led is-off'} />
              <span className="preset-text">
                <span>{preset.name}</span>
                <small>{preset.usedBy.length ? `Used by ${preset.usedBy[0]}` : `Saved ${dateText(preset.updatedAt)}`}</small>
              </span>
            </button>
            <Menu
              label={`More for ${preset.name}`}
              trigger={
                <button className="btn btn-sm btn-icon btn-ghost" type="button" aria-label={`More for ${preset.name}`}>
                  <MoreHorizontal className="i i-sm" aria-hidden="true" />
                </button>
              }
              items={[
                { label: 'Apply', onSelect: () => onApply(preset) },
                {
                  label: 'Save the current controls here',
                  onSelect: () => void patch(preset, { values: currentValues }, `Updated “${preset.name}”`),
                },
                {
                  label: 'Rename',
                  onSelect: () => {
                    setName(preset.name);
                    setRenaming(preset);
                  },
                },
                'separator',
                { label: 'Delete', danger: true, onSelect: () => setDeleting(preset) },
              ]}
            />
          </div>
        );
      })}

      <Dialog
        open={Boolean(renaming)}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename the preset"
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={async () => {
                if (!renaming) return;
                await patch(renaming, { name }, 'Renamed');
                setRenaming(null);
              }}
            >
              Rename
            </Button>
          </>
        }
      >
        <Field label="Name">{({ id }) => <Input id={id} value={name} autoFocus onChange={(e) => setName(e.target.value)} />}</Field>
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={
          deleting?.usedBy.length
            ? `${deleting.usedBy.join(', ')} keeps its own copy of these values and goes on running.`
            : 'The controls stay as they are. Only the saved preset goes.'
        }
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => deleting && void remove(deleting)}>
              Delete preset
            </Button>
          </>
        }
      />
    </div>
  );
}
