import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import type { SallaWebhookRequest } from '../security/salla-webhook.guard';
import { WebhookIdempotencyService } from '../security/webhook-idempotency.service';

/**
 * Pairs with SallaWebhookGuard:
 *  - duplicate delivery → 200 `{ status: "duplicate" }` without running the handler
 *  - handler success    → mark the key done
 *  - handler failure    → release the key so Salla's retry is processed
 */
@Injectable()
export class WebhookIdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(WebhookIdempotencyInterceptor.name);

  constructor(private readonly idempotency: WebhookIdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<SallaWebhookRequest>();
    const ctx = req.sallaWebhook;
    if (!ctx) return next.handle();

    if (ctx.duplicate) {
      this.logger.debug(`Duplicate webhook ignored (${ctx.idempotencyKey})`);
      return of({ status: 'duplicate' });
    }

    return next.handle().pipe(
      mergeMap((result) =>
        from(this.idempotency.complete(ctx.idempotencyKey)).pipe(mergeMap(() => of(result))),
      ),
      catchError((err) =>
        from(this.idempotency.release(ctx.idempotencyKey)).pipe(
          mergeMap(() => throwError(() => err)),
        ),
      ),
    );
  }
}
