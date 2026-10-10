import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthedRequest } from './session.guard';
import { tenantStorage } from '../../infra/tenant-context';

/**
 * Binds the authenticated tenant to AsyncLocalStorage for the lifetime of the request, so TenantDb can
 * only ever see the tenant from the verified session — never from a header, query or body.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!auth) return next.handle(); // public route
    return new Observable((subscriber) =>
      tenantStorage.run(auth, () => next.handle().subscribe(subscriber)),
    );
  }
}
