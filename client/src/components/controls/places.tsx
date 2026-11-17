'use client';

import { MapPin, X } from 'lucide-react';
import { Popover as RPopover } from 'radix-ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Place } from '@/contracts/places';
import { addWords } from './scale';

/**
 * Place names an API accepts (board 07, "Place list"): chips with a pin, and a search over GeoNames cities
 * and countries through /api/places. Picking adds the place's name; Enter adds what's typed as it is.
 */
export function PlacesInput({
  value,
  onChange,
  label,
  foot,
  disabled,
  invalid,
  id,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  label: string;
  /** The menu's foot: "No radius in this API" and the parameter. */
  foot?: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
}) {
  const [draft, setDraft] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const seq = useRef(0);

  useEffect(() => {
    const q = draft.trim();
    if (q.length < 2) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { places?: Place[] };
        if (mine === seq.current) {
          setResults(data.places ?? []);
          setActive(0);
          setOpen(true);
        }
      } catch {
        if (mine === seq.current) setResults([]);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [draft]);

  const add = (name: string) => {
    if (name.trim()) onChange(addWords(value, [name.trim()]));
    setDraft('');
    setResults([]);
    setOpen(false);
  };

  return (
    <RPopover.Root open={open && results.length > 0 && draft.trim().length >= 2} onOpenChange={setOpen}>
      <RPopover.Anchor asChild>
        <label className={['tags', open ? 'is-focus' : '', invalid ? 'is-err' : ''].filter(Boolean).join(' ')}>
          {value.map((place) => (
            <span key={place} className="chip is-on">
              <MapPin className="i" aria-hidden="true" />
              {place}
              {!disabled && (
                <button
                  className="chip-x"
                  type="button"
                  aria-label={`Remove ${place}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onChange(value.filter((p) => p !== place));
                  }}
                >
                  <X className="i" aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
          <span className="sr">{label}</span>
          {!disabled && (
            <input
              id={id}
              type="text"
              role="combobox"
              aria-expanded={open && results.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-invalid={invalid || undefined}
              value={draft}
              placeholder={value.length ? '' : 'Add a place'}
              onChange={(e) => {
                setDraft(e.target.value);
                if (e.target.value.trim().length < 2) setResults([]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && results.length) {
                  e.preventDefault();
                  setOpen(true);
                  setActive((a) => Math.min(results.length - 1, a + 1));
                } else if (e.key === 'ArrowUp' && results.length) {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  add(open && results[active] ? results[active].name : draft);
                } else if (e.key === 'Escape') setOpen(false);
                else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
              }}
            />
          )}
        </label>
      </RPopover.Anchor>
      <RPopover.Portal>
        <RPopover.Content
          sideOffset={6}
          align="start"
          className="pop-layer"
          style={{ minWidth: 280 }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="menu is-floating" role="listbox" id={listId} aria-label={label}>
            {results.map((place, i) => (
              <button
                key={`${place.kind}-${place.name}-${place.detail}`}
                className="opt"
                type="button"
                role="option"
                aria-selected={i === active}
                data-active={i === active || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => add(place.name)}
              >
                <MapPin className="i i-sm" aria-hidden="true" />
                {place.name}
                <span className="end">{place.detail}</span>
              </button>
            ))}
            {foot && <div className="menu-foot">{foot}</div>}
          </div>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
