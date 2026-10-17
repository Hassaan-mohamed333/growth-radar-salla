'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CompetitorItem } from '../../lib/api';
import { DeleteCompetitorDialog, EditCompetitorDialog } from './competitor-dialogs';

type Competitor = Pick<CompetitorItem, 'id' | 'name' | 'productUrl'>;
type Dialog = 'edit' | 'delete';

/**
 * Per-row options (edit or delete). The dropdown is position: fixed so the table's
 * overflow box can't clip it, and it closes on scroll rather than tracking the row.
 */
export function CompetitorMenu({ competitor }: { competitor: Competitor }) {
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const open = menu !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setMenu(null);
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle() {
    if (open) return setMenu(null);
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    // Align the menu's end edge with the trigger's (RTL-safe: measured from the right).
    setMenu({ top: r.bottom + 4, right: document.documentElement.clientWidth - r.right });
  }

  function choose(next: Dialog) {
    setMenu(null);
    setDialog(next);
  }

  // Return focus to the trigger so keyboard users land back where they were.
  function closeDialog() {
    setDialog(null);
    triggerRef.current?.focus();
  }

  return (
    <div ref={wrapRef} className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`خيارات ${competitor.name}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggle}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-brand-darkest"
      >
        <DotsIcon />
      </button>

      {menu && (
        <div
          id={menuId}
          style={{ top: menu.top, right: menu.right }}
          className="fixed z-20 w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            onClick={() => choose('edit')}
            className="block w-full px-3 py-2 text-start text-sm text-slate-700 hover:bg-brand-lightest hover:text-brand-darkest"
          >
            تعديل
          </button>
          <button
            type="button"
            onClick={() => choose('delete')}
            className="block w-full px-3 py-2 text-start text-sm text-red-700 hover:bg-red-50"
          >
            حذف
          </button>
        </div>
      )}

      {dialog === 'edit' && <EditCompetitorDialog competitor={competitor} onClose={closeDialog} />}
      {dialog === 'delete' && (
        <DeleteCompetitorDialog competitor={competitor} onClose={closeDialog} />
      )}
    </div>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="currentColor">
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}
