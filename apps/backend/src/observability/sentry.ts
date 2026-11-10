import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

/**
 * Error reporting. Off unless SENTRY_DSN is set, so local runs and tests never send anything.
 *
 * What is sent is deliberately minimal: stack trace, route and status. Cookies (the session JWT),
 * headers (Authorization, Salla webhook signature), request bodies, query strings and user data
 * are removed before leaving the process.
 */
export function initSentry(opts: { dsn: string | undefined; environment: string; release?: string }): boolean {
  if (!opts.dsn) return false;
  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  return true;
}

export function scrubEvent<E extends Sentry.ErrorEvent>(event: E): E {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
  }
  delete event.user;
  return event;
}

/** Reports server faults (non-HTTP errors and 5xx), then lets Nest answer as it normally would. */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) Sentry.captureException(exception);
    super.catch(exception, host);
  }
}
