'use client';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

/** Theme lives in a cookie so the server renders the right data-theme on first paint (no flash, no inline script). */
export function ThemeToggle({ initial, labels }: { initial: Theme; labels: Record<Theme, string> }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const set = (t: Theme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    document.cookie = `radar_theme=${t}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  const items: [Theme, typeof Sun][] = [['light', Sun], ['dark', Moon], ['system', Monitor]];
  return (
    <div role="group" aria-label="Theme" className="inline-flex rounded-xl border border-border bg-surface-2 p-0.5">
      {items.map(([k, Icon]) => (
        <button
          key={k} type="button" onClick={() => set(k)} aria-pressed={theme === k} title={labels[k]}
          className={`grid size-8 place-items-center rounded-lg transition-colors ${theme === k ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
        >
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{labels[k]}</span>
        </button>
      ))}
    </div>
  );
}
