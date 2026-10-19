import 'reflect-metadata';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppModule } from './app.module';
import { AuthModule } from './auth/auth.module';
import { CompetitorsModule } from './competitors/competitors.module';
import { DataConfidenceModule } from './data-confidence/data-confidence.module';
import { ProductsModule } from './products/products.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { StoreModule } from './store/store.module';
import { WebhooksModule } from './webhooks/webhooks.module';

describe('AppModule', () => {
  // The integration suites build their own test modules, so a feature module that is imported
  // here but never listed would pass every test and still serve 404 in production. That is
  // exactly how /api/v1/data-confidence went unmounted.
  it('mounts every feature module that exposes routes', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[];

    for (const feature of [
      AuthModule,
      StoreModule,
      AnalyticsModule,
      CompetitorsModule,
      DataConfidenceModule,
      ProductsModule,
      RecommendationsModule,
      WebhooksModule,
    ]) {
      expect(imports).toContain(feature);
    }
  });
});
