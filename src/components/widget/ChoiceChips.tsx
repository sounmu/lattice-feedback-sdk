'use client';

import { useRef, type KeyboardEvent } from 'react';

interface ChoiceChipOption<Value extends string> {
  value: Value;
  label: string;
}

interface ChoiceChipsProps<Value extends string> {
  /** Names the group for assistive technology. It is not shown. */
  label: string;
  options: readonly ChoiceChipOption<Value>[];
  /** Null while nothing is chosen yet; the first chip is then the group's tab stop. */
  value: Value | null;
  onChange: (value: Value) => void;
  /** Keeps the chips readable and in the tab order, but no choice can be made. */
  isDisabled?: boolean;
}

const NEXT_KEYS = ['ArrowRight', 'ArrowDown'];
const PREVIOUS_KEYS = ['ArrowLeft', 'ArrowUp'];

function findTargetIndex(key: string, index: number, count: number): number | null {
  if (NEXT_KEYS.includes(key)) {
    return (index + 1) % count;
  }
  if (PREVIOUS_KEYS.includes(key)) {
    return (index - 1 + count) % count;
  }
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return count - 1;
  }
  return null;
}

// One choice out of a few, drawn as separate chips that wrap onto more rows when they do not fit. It is a
// radio group: the chosen chip is the group's one tab stop, and the arrow keys move the choice. Each chip
// changes its own look, so nothing travels across the other chips or between rows when the choice changes.
export function ChoiceChips<Value extends string>({ label, options, value, onChange, isDisabled = false }: ChoiceChipsProps<Value>) {
  const groupRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isDisabled || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const selectedIndex = options.findIndex((option) => option.value === value);
    // With nothing chosen, the next key lands on the first chip and the previous key on the last one.
    const fromIndex = selectedIndex < 0 && PREVIOUS_KEYS.includes(event.key) ? 0 : selectedIndex;
    const targetIndex = findTargetIndex(event.key, fromIndex, options.length);
    if (targetIndex === null) {
      return;
    }
    event.preventDefault();
    onChange(options[targetIndex].value);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[targetIndex]?.focus();
  }

  function handleChoose(chosen: Value) {
    if (!isDisabled) {
      onChange(chosen);
    }
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      aria-disabled={isDisabled || undefined}
      className="widget-chips"
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        const isTabStop = isSelected || (value === null && option === options[0]);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-disabled={isDisabled || undefined}
            tabIndex={isTabStop ? 0 : -1}
            data-value={option.value}
            className="widget-chip"
            onClick={() => handleChoose(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
