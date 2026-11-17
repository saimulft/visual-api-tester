'use client';

import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { addWords, splitWords } from './scale';

/**
 * Words as chips (the canvas's .tags box): type and press Enter or a comma to add, paste a list to add
 * them all, Backspace in the empty box takes the last one off.
 */
export function KeywordsInput({
  value,
  onChange,
  label,
  placeholder = 'Add a word',
  disabled,
  icon,
  invalid,
  id,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** An icon in each chip (a map pin for places). */
  icon?: ReactNode;
  invalid?: boolean;
  id?: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = (text: string) => {
    const words = splitWords(text);
    if (words.length) onChange(addWords(value, words));
    setDraft('');
  };
  return (
    <label className={invalid ? 'tags is-err' : 'tags'}>
      {value.map((word) => (
        <span key={word} className="chip is-on">
          {icon}
          {word}
          {!disabled && (
            <button
              className="chip-x"
              type="button"
              aria-label={`Remove ${word}`}
              onClick={(e) => {
                e.preventDefault();
                onChange(value.filter((w) => w !== word));
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
          value={draft}
          placeholder={value.length ? '' : placeholder}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const text = e.target.value;
            if (/[,;\n]/.test(text)) commit(text);
            else setDraft(text);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft.trim() && commit(draft)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (/[,;\n]/.test(text)) {
              e.preventDefault();
              commit(`${draft}${text}`);
            }
          }}
        />
      )}
    </label>
  );
}
