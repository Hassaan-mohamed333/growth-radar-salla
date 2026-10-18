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

  // Render terminates TLS in front of the app: trust exactly one proxy hop so the
  // client IP (used by the rate limiter) comes from X-Forwarded-For, not the proxy.
  app.set('trust proxy', 1);
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
