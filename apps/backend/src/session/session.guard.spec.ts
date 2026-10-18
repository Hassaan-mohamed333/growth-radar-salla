import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { SessionGuard } from './session.guard';
import type { SessionService } from './session.service';

function setup(opts: { claims: { tenantId: string; storeId: string } | null; store: unknown }) {
  const findFirst = jest.fn().mockResolvedValue(opts.store);
  const verify = jest.fn().mockReturnValue(opts.claims);
  const sessions = { readCookie: jest.fn().mockReturnValue('token'), verify } as unknown as SessionService;
  const prisma = { store: { findFirst } } as unknown as PrismaService;

  const req: Record<string, unknown> = {};
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;

  return { guard: new SessionGuard(sessions, prisma), findFirst, verify, req, context };
}

describe('SessionGuard', () => {
  it('admits a session only for an ACTIVE store of the claimed tenant', async () => {
    const { guard, findFirst, req, context } = setup({
      claims: { tenantId: 't1', storeId: 's1' },
      store: { id: 's1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 's1', tenantId: 't1', status: 'ACTIVE' },
      select: { id: true },
    });
    expect(req.session).toEqual({ tenantId: 't1', storeId: 's1' });
  });

  it('rejects a valid cookie once the store is no longer ACTIVE', async () => {
    // The status filter lives in the query, so an uninstalled or suspended store comes back as null.
    const { guard, req, context } = setup({
      claims: { tenantId: 't1', storeId: 's1' },
      store: null,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(req.session).toBeUndefined();
  });

  it('rejects a forged or expired token without touching the database', async () => {
    const { guard, findFirst, context } = setup({ claims: null, store: { id: 's1' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
