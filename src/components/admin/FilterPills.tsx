/**
 * src/components/admin/FilterPills.tsx
 *
 * Controlled URL-state filter row. Reads from useSearchParams, writes
 * via router.replace. Each pill is a native <select> styled to match
 * tokens; the search box is a debounced <input>.
 *
 * Spec: BRD-admin-ui-design §3.6, §1.3.
 *
 * Why client component: writes URL state via router. Reads also need
 * to live client-side so changing one filter doesn't trigger a full
 * server roundtrip — the page re-renders with new searchParams via
 * router.replace and Next picks it up.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { tokens } from '@/styles/tokens';

export interface PillOption {
  value: string;
  label: string;
}

export interface PillSpec {
  /** URL search-param key. */
  param: string;
  label: string;
  options: PillOption[];
  /** Default value when the param is absent (rendered as the "all" pill). */
  defaultValue: string;
}

export interface FilterPillsProps {
  pills: PillSpec[];
  /** When set, also renders a debounced search input writing to this param. */
  searchParam?: string;
  searchPlaceholder?: string;
}

export function FilterPills({ pills, searchParam, searchPlaceholder = 'search…' }: FilterPillsProps) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const pathname     = usePathname();

  function setParam(key: string, value: string, defaultValue: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    // Reset to page 0 whenever a filter changes (sort untouched).
    next.delete('page');
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      {pills.map((pill) => (
        <Pill
          key={pill.param}
          pill={pill}
          value={searchParams.get(pill.param) ?? pill.defaultValue}
          onChange={(v) => setParam(pill.param, v, pill.defaultValue)}
        />
      ))}
      {searchParam ? (
        <SearchInput
          param={searchParam}
          placeholder={searchPlaceholder}
          initial={searchParams.get(searchParam) ?? ''}
          onChange={(v) => {
            const next = new URLSearchParams(searchParams.toString());
            if (v === '') next.delete(searchParam);
            else next.set(searchParam, v);
            next.delete('page');
            router.replace(`${pathname}?${next.toString()}`);
          }}
        />
      ) : null}
    </div>
  );
}

function Pill({
  pill, value, onChange,
}: { pill: PillSpec; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: tokens.text.muted }}>
      <span>{pill.label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: tokens.bg.surface,
          color: tokens.text.primary,
          border: `1px solid ${tokens.border.subtle}`,
          padding: '2px 6px',
          fontSize: 12,
          fontFamily: tokens.font.mono,
        }}
      >
        {pill.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function SearchInput({
  param, placeholder, initial, onChange,
}: {
  param: string;          // unused, kept for clarity
  placeholder: string;
  initial: string;
  onChange: (v: string) => void;
}) {
  void param;
  // `initial` is only consulted on mount. We deliberately don't sync
  // prop → state when `initial` changes from outside (lint:
  // react-hooks/set-state-in-effect, but also a real footgun — the
  // user's typed value would clobber on every URL update, including
  // the URL update we ourselves triggered after debounce). Trade-off
  // accepted: back/forward navigation does not refill the input.
  const [val, setVal] = useState(initial);

  useEffect(() => {
    const t = setTimeout(() => {
      if (val !== initial) onChange(val);
    }, 250);
    return () => clearTimeout(t);
  }, [val, initial, onChange]);

  return (
    <input
      type="search"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      placeholder={placeholder}
      style={{
        background: tokens.bg.surface,
        color: tokens.text.primary,
        border: `1px solid ${tokens.border.subtle}`,
        padding: '2px 6px',
        fontSize: 12,
        fontFamily: tokens.font.mono,
        minWidth: 200,
      }}
    />
  );
}
