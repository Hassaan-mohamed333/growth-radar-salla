import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap() {
  // rawBody: required so the Salla webhook guard can HMAC the exact bytes received.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const config = app.get(ConfigService<Env, true>);

  // Reverse proxies in front of the app (Render terminates TLS). Trust exactly that many hops so
  // req.ip comes from X-Forwarded-For instead of the proxy's own address. Never `true`: that would
  // let any client spoof its IP. Authenticated rate limits do not depend on this (see
  // SessionThrottlerGuard); it only matters for anonymous routes.
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  app.disable('x-powered-by');
  app.use(helmet());
  app.enableCors({
    origin: config.get('FRONTEND_ORIGIN', { infer: true }),
    credentials: true,
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
