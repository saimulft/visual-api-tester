'use client';

import { Command } from 'cmdk';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Popover as RPopover, Select as RSelect } from 'radix-ui';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * Styled dropdowns, never the browser's own menu:
 * - Select: a short list (Radix Select), the canvas's .select button over a .menu of .opt rows.
 * - SearchSelect: a long list with a search box (cmdk in a popover).
 * - MultiSelect: chips in a .tags box, with a searchable list of checkboxes under it.
 */
export type Option<T extends string = string> = { value: T; label: string; end?: ReactNode; icon?: ReactNode };

export function Select<T extends string>({
  options,
  value,
  onChange,
  placeholder = 'Pick one',
  label,
  id,
  disabled,
  foot,
  className,
}: {
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  /** The accessible name when there's no visible label pointing at `id`. */
  label?: string;
  id?: string;
  disabled?: boolean;
  /** A line under the list (the canvas's .menu-foot). */
  foot?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  // .pop keeps Radix's hidden form <select> inside this box, so it can't stretch the page.
  return (
    <div className="pop">
      <RSelect.Root
        value={value ?? undefined}
        onValueChange={(v) => onChange(v as T)}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
      >
        <RSelect.Trigger className={cn('select', className)} id={id} aria-label={label} aria-expanded={open}>
          <span className="val">{current ? current.label : <span className="muted">{placeholder}</span>}</span>
          <RSelect.Icon asChild>
            <ChevronDown className="i chev" aria-hidden="true" />
          </RSelect.Icon>
        </RSelect.Trigger>
        <RSelect.Portal>
          <RSelect.Content
            className="menu is-floating"
            position="popper"
            sideOffset={6}
            style={{ minWidth: 'var(--radix-select-trigger-width)' }}
          >
            <RSelect.Viewport>
              {options.map((option) => (
                <RSelect.Item key={option.value} value={option.value} className="opt">
                  {option.icon}
                  <RSelect.ItemText>{option.label}</RSelect.ItemText>
                  {option.end !== undefined ? (
                    <span className="end">{option.end}</span>
                  ) : (
                    <RSelect.ItemIndicator className="end">
                      <Check className="i i-sm" aria-hidden="true" />
                    </RSelect.ItemIndicator>
                  )}
                </RSelect.Item>
              ))}
            </RSelect.Viewport>
            {foot && <div className="menu-foot">{foot}</div>}
          </RSelect.Content>
        </RSelect.Portal>
      </RSelect.Root>
    </div>
  );
}

function SearchList<T extends string>({
  options,
  chosen,
  onPick,
  searchLabel,
  placeholder,
  multi,
  foot,
  empty = 'Nothing matches.',
}: {
  options: Option<T>[];
  chosen: Set<string>;
  onPick: (value: T) => void;
  searchLabel: string;
  placeholder: string;
  multi?: boolean;
  foot?: ReactNode;
  empty?: string;
}) {
  return (
    <Command
      className="menu is-floating"
      filter={(value, search) => (value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)}
      aria-multiselectable={multi || undefined}
    >
      <label className="input menu-search">
        <Search className="i i-sm" aria-hidden="true" />
        <span className="sr">{searchLabel}</span>
        <Command.Input placeholder={placeholder} />
      </label>
      <Command.List className="menu-list">
        <Command.Empty className="menu-empty">{empty}</Command.Empty>
        {options.map((option) => {
          const on = chosen.has(option.value);
          return (
            <Command.Item
              key={option.value}
              value={`${option.label} ${option.value}`}
              onSelect={() => onPick(option.value)}
              className="opt"
              data-chosen={on}
            >
              {multi && (
                <span className={cn('cbox', on && 'is-on')}>{on && <Check className="i" aria-hidden="true" />}</span>
              )}
              {option.icon}
              {option.label}
              {option.end !== undefined ? (
                <span className="end">{option.end}</span>
              ) : (
                !multi && on && <Check className="i i-sm end" aria-hidden="true" />
              )}
            </Command.Item>
          );
        })}
      </Command.List>
      {foot && <div className="menu-foot">{foot}</div>}
    </Command>
  );
}

/** One pick from a long list, with a search box. */
export function SearchSelect<T extends string>({
  options,
  value,
  onChange,
  placeholder = 'Pick one',
  searchPlaceholder = 'Search',
  label,
  id,
  disabled,
  foot,
}: {
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  label?: string;
  id?: string;
  disabled?: boolean;
  foot?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <RPopover.Root open={open} onOpenChange={setOpen}>
      <RPopover.Trigger
        className="select"
        id={id}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        type="button"
      >
        <span className="val">{current ? current.label : <span className="muted">{placeholder}</span>}</span>
        <ChevronDown className="i chev" aria-hidden="true" />
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          sideOffset={6}
          align="start"
          className="pop-layer"
          style={{ width: 'var(--radix-popover-trigger-width)', minWidth: 240 }}
        >
          <SearchList
            options={options}
            chosen={new Set(value ? [value] : [])}
            onPick={(v) => {
              onChange(v);
              setOpen(false);
            }}
            searchLabel={label ?? 'Search'}
            placeholder={searchPlaceholder}
            foot={foot}
          />
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/** Several picks from a long list: chosen ones show as chips you can remove. */
export function MultiSelect<T extends string>({
  options,
  value,
  onChange,
  placeholder = 'Add',
  searchPlaceholder = 'Search',
  label,
  id,
  disabled,
  foot,
}: {
  options: Option<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  label: string;
  id?: string;
  disabled?: boolean;
  foot?: (picked: number) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const chosen = useMemo(() => new Set<string>(value), [value]);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const toggle = (v: T) => onChange(chosen.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <RPopover.Root open={open} onOpenChange={setOpen}>
      <RPopover.Anchor asChild>
        <div className={cn('tags', open && 'is-focus')}>
          {value.map((v) => (
            <span key={v} className="chip is-on">
              {byValue.get(v)?.label ?? v}
              <button
                className="chip-x"
                type="button"
                aria-label={`Remove ${byValue.get(v)?.label ?? v}`}
                onClick={() => toggle(v)}
                disabled={disabled}
              >
                <X className="i" aria-hidden="true" />
              </button>
            </span>
          ))}
          <RPopover.Trigger
            className="tags-add"
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={label}
            disabled={disabled}
          >
            {placeholder}
          </RPopover.Trigger>
        </div>
      </RPopover.Anchor>
      <RPopover.Portal>
        <RPopover.Content sideOffset={6} align="start" className="pop-layer" style={{ minWidth: 280 }}>
          <SearchList
            options={options}
            chosen={chosen}
            onPick={toggle}
            searchLabel={`Search ${label.toLowerCase()}`}
            placeholder={searchPlaceholder}
            multi
            foot={foot ? foot(value.length) : `${value.length} picked`}
          />
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
