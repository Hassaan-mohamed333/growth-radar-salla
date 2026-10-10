import type { ReactNode } from 'react';

export function Card({ title, hint, icon, children, className = '' }: { title: string; hint?: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-5 shadow-sm ${className}`}>
      <header className="mb-4 flex items-start gap-3">
        {icon ? <span className="mt-0.5 text-muted" aria-hidden>{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {hint ? <p className="text-sm text-muted">{hint}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}
