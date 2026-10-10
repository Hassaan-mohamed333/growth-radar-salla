import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { WEBHOOK_PATH } from './salla/webhook.controller';
import { APP_ROLE_API } from './config/role';

async function bootstrap() {
  const env = loadEnv(); // fail fast on any missing/weak secret, before opening a port
  const adapter = new FastifyAdapter({
    trustProxy: env.TRUST_PROXY, // only trust X-Forwarded-For when explicitly behind a known proxy (rate-limit key = real IP)
    bodyLimit: 1024 * 1024,
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-salla-signature"]', 'res.headers["set-cookie"]'],
      // Log method + path only: OAuth callback URLs carry `code` and `state` in the query string.
      serializers: {
        req: (r: { method: string; url: string; id: string }) => ({ id: r.id, method: r.method, url: r.url.split('?')[0] }),
        res: (r: { statusCode: number }) => ({ statusCode: r.statusCode }),
      },
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true, bodyParser: false });
  const fastify = app.getHttpAdapter().getInstance();

  // JSON parsing policy: the webhook route receives the UNTOUCHED bytes (HMAC is verified over them, then parsed
  // in the controller). Every other route gets a prototype-poisoning-safe JSON parse.
  const safeJson = fastify.getDefaultJsonParser('error', 'error'); // rejects __proto__ / constructor.prototype keys
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (req, body, done) => {
    if (req.url.split('?')[0] === WEBHOOK_PATH) return done(null, body);
    safeJson(req, (body as Buffer).toString('utf8'), done);
  });

  await app.register(fastifyHelmet as never, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, // pure JSON API
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  });
  await app.register(fastifyCors as never, { origin: [env.WEB_URL], credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  await app.register(fastifyCookie as never);

  app.enableShutdownHooks();
  if (APP_ROLE_API) {
    await app.listen(env.PORT, '0.0.0.0');
    new Logger('Bootstrap').log(`API (${env.APP_ROLE}) listening on :${env.PORT}`);
  } else {
    await app.init(); // worker-only: queue consumers run, no HTTP port is opened
    new Logger('Bootstrap').log('Worker started (no HTTP listener)');
  }
}

void bootstrap();
