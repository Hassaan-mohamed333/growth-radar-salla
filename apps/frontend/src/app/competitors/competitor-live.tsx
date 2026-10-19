'use client';

// Optimistic overrides for a competitor row. The table itself is rendered on the server, but a
// pause/resume or a manual price should show at once, before the refreshed data arrives.
//
// An action calls patchCompetitor(); every live cell of that competitor listens for it, shows the
// patched value, and drops the override as soon as the refreshed server data changes (or the
// action rolls back with patchCompetitor(id, null)).
//
// First paint always uses the server-rendered markup (passed as children / props). Dates are
// formatted on the server's clock, so re-formatting them here before hydration would mismatch;
// we only format client-side for a value the merchant has just entered.

import { useEffect, useState, type ReactNode } from 'react';
import { formatDate, money } from '../../lib/format';

export interface CompetitorServerState {
  isActive: boolean;
  lastPrice: string | null;
  lastCheckedAt: string | null;
}

interface Patch {
  isActive?: boolean;
  lastPrice?: string;
  lastCheckedAt?: string;
}

interface PatchDetail {
  id: string;
  /** null clears every override of that competitor (rollback). */
  patch: Patch | null;
}

const EVENT = 'radar:competitor-patch';

export function patchCompetitor(id: string, patch: Patch | null): void {
  window.dispatchEvent(new CustomEvent<PatchDetail>(EVENT, { detail: { id, patch } }));
}

export function useCompetitorLive(id: string, server: CompetitorServerState): CompetitorServerState {
  const [patch, setPatch] = useState<Patch>({});

  // Refreshed server data replaces the optimistic value.
  useEffect(() => {
    setPatch({});
  }, [server.isActive, server.lastPrice, server.lastCheckedAt]);

  useEffect(() => {
    function onPatch(e: Event) {
      const detail = (e as CustomEvent<PatchDetail>).detail;
      if (detail.id !== id) return;
      setPatch((prev) => (detail.patch === null ? {} : { ...prev, ...detail.patch }));
    }
    window.addEventListener(EVENT, onPatch);
    return () => window.removeEventListener(EVENT, onPatch);
  }, [id]);

  return {
    isActive: patch.isActive ?? server.isActive,
    lastPrice: patch.lastPrice ?? server.lastPrice,
    lastCheckedAt: patch.lastCheckedAt ?? server.lastCheckedAt,
  };
}

/** The table row; paused rows are dimmed. */
export function LiveRow({
  id,
  server,
  children,
}: {
  id: string;
  server: CompetitorServerState;
  children: ReactNode;
}) {
  const live = useCompetitorLive(id, server);
  return <tr className={live.isActive ? undefined : 'bg-slate-50 text-slate-500'}>{children}</tr>;
}

/** Last price cell. `children` is the server-rendered cell, shown until a new value is entered. */
export function LivePrice({
  id,
  server,
  currency,
  children,
}: {
  id: string;
  server: CompetitorServerState;
  currency: string;
  children: ReactNode;
}) {
  const live = useCompetitorLive(id, server);
  const patched = live.lastPrice !== server.lastPrice || live.lastCheckedAt !== server.lastCheckedAt;
  if (!patched || live.lastPrice === null) return <>{children}</>;
  return (
    <>
      <span className="font-medium">{money(Number(live.lastPrice), currency)}</span>
      <span className="block text-xs text-slate-500">{formatDate(live.lastCheckedAt)}</span>
    </>
  );
}

/** Status cell: both variants are rendered on the server, the live state picks one. */
export function LiveStatus({
  id,
  server,
  active,
  paused,
}: {
  id: string;
  server: CompetitorServerState;
  active: ReactNode;
  paused: ReactNode;
}) {
  const live = useCompetitorLive(id, server);
  return <>{live.isActive ? active : paused}</>;
}
