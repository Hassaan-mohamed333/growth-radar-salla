'use client';

// "Add competitor" opens the form in a native <dialog> modal, the same way editing does: the
// browser supplies focus trapping, Escape to close and the top layer. The form is mounted only
// while open, so each opening starts empty.

import { useEffect, useRef, useState } from 'react';
import { AddCompetitorForm } from './add-competitor-form';

export function AddCompetitorDialog() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    // Return focus to the button that opened the dialog.
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand-dark px-5 py-2 text-sm font-medium text-white hover:bg-brand-darkest"
      >
        إضافة منافس
      </button>
      {open && <AddDialog onClose={close} />}
    </>
  );
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="add-heading"
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself, not on its content.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-full max-w-xl rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-brand-darkest/40"
    >
      <AddCompetitorForm bare onDone={onClose} onCancel={onClose} />
    </dialog>
  );
}
