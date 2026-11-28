import { type DynamicModule, Module } from '@nestjs/common';
import type { Db } from '@jays/db';
import { LoggerModule } from 'nestjs-pino';
import { AdminAuthGuard } from './admin/admin.guard.js';
import { AdminAftercareController } from './aftercare/admin-aftercare.controller.js';
import { BusinessAftercareController } from './aftercare/business-aftercare.controller.js';
import {
  CustomerAftercareController,
  PublicReviewsController,
  SupportInfoController,
} from './aftercare/customer-aftercare.controller.js';
import { DashboardsService } from './aftercare/dashboards.service.js';
import { ExportsService } from './aftercare/exports.service.js';
import { FulfillmentService } from './aftercare/fulfillment.service.js';
import { NotificationScheduler, NotificationsService } from './aftercare/notifications.service.js';
import { ReturnsService } from './aftercare/returns.service.js';
import { ReviewsService } from './aftercare/reviews.service.js';
import { SupportService } from './aftercare/support.service.js';
import { AdminBusinessesController } from './admin/admin-businesses.controller.js';
import { AdminBusinessesService } from './admin/admin-businesses.service.js';
import { AdminProductsController } from './admin/admin-products.controller.js';
import { AdminProductsService } from './admin/admin-products.service.js';
import { AdminBookingsController } from './booking/admin-bookings.controller.js';
import { AdminBookingsService } from './booking/admin-bookings.service.js';
import {
  AdminHomeServicesController,
  BusinessHomeServicesController,
} from './booking/home-services.controller.js';
import { HomeServicesService } from './booking/home-services.service.js';
import { BookingsController } from './booking/bookings.controller.js';
import { BookingsService } from './booking/bookings.service.js';
import { BusinessScheduleController } from './booking/business-schedule.controller.js';
import { ScheduleService } from './booking/schedule.service.js';
import { AdminTaxonomyController } from './catalog/admin-taxonomy.controller.js';
import { BusinessCatalogController } from './catalog/business-catalog.controller.js';
import { InventoryService } from './catalog/inventory.service.js';
import { ProductsService } from './catalog/products.service.js';
import { PublicProductsService } from './catalog/public-products.service.js';
import { CartService } from './commerce/cart.service.js';
import { CheckoutService } from './commerce/checkout.service.js';
import { CommerceController } from './commerce/commerce.controller.js';
import { OrdersService } from './commerce/orders.service.js';
import {
  httpWebhookSink,
  MockPaymentProvider,
  type WebhookSink,
} from './payments/mock-provider.js';
import { MockPspController, WebhooksController } from './payments/payments.controller.js';
import { PaymentsService } from './payments/payments.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payments/provider.js';
import { AdminFinanceController } from './finance/admin-finance.controller.js';
import { AdminFinanceService } from './finance/admin-finance.service.js';
import { BusinessFinanceController } from './finance/business-finance.controller.js';
import { FinanceScheduler } from './finance/finance-scheduler.js';
import { FinanceService } from './finance/finance.service.js';
import {
  AdminTaxController,
  BusinessDocumentsController,
  CustomerDocumentsController,
} from './finance/tax.controller.js';
import { TaxService } from './finance/tax.service.js';
import { PayoutsService } from './finance/payouts.service.js';
import { ReconciliationService } from './finance/reconciliation.service.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { StoresService } from './catalog/stores.service.js';
import { TaxonomyService } from './catalog/taxonomy.service.js';
import { OnboardingController } from './onboarding/onboarding.controller.js';
import { OnboardingService } from './onboarding/onboarding.service.js';
import { LocalObjectStorage } from './storage/local-storage.js';
import { MockMalwareScanner } from './storage/scanner.js';
import { LocalStorageController } from './storage/storage.controller.js';
import {
  MALWARE_SCANNER,
  type MalwareScanner,
  OBJECT_STORAGE,
  type ObjectStorage,
} from './storage/storage.js';
import { AdminAuthController, AdminController } from './admin/admin.controller.js';
import { AdminService } from './admin/admin.service.js';
import { AuthController } from './auth/auth.controller.js';
import {
  ACCESS_TOKENS,
  ADMIN_SESSIONS,
  SECRET_BOX,
  USER_SESSIONS,
} from './auth/auth.module-tokens.js';
import { AuthService } from './auth/auth.service.js';
import { SecretBox } from './auth/crypto.js';
import { OptionalUserAuthGuard, UserAuthGuard } from './auth/guards.js';
import { AccessTokens } from './auth/jwt.js';
import { MockNotifier, type Notifier } from './auth/notifier.js';
import {
  ADMIN_ACCESS_TTL_SECONDS,
  ADMIN_REFRESH_ABSOLUTE_SECONDS,
  ADMIN_REFRESH_IDLE_SECONDS,
  USER_ACCESS_TTL_SECONDS,
  USER_REFRESH_ABSOLUTE_SECONDS,
  USER_REFRESH_IDLE_SECONDS,
} from './auth/policy.js';
import { SessionStore } from './auth/sessions.js';
import { BusinessAccessGuard } from './businesses/business-access.guard.js';
import { BusinessesController } from './businesses/businesses.controller.js';
import { BusinessesService } from './businesses/businesses.service.js';
import { CLOCK, type Clock, systemClock } from './common/clock.js';
import { loggerParams } from './common/logging.js';
import { RATE_LIMITER, type RateLimiter, RedisRateLimiter } from './common/rate-limit.js';
import { DB, NOTIFIER } from './common/tokens.js';
import { API_ENV, type ApiEnv } from './config.js';
import { DEPENDENCY_PROBES, type DependencyProbe } from './health/dependencies.js';
import { HealthController } from './health/health.controller.js';
import { Infrastructure } from './health/infrastructure.js';
import { MeController } from './me/me.controller.js';
import { PrivacyController, UnsubscribeController } from './privacy/privacy.controller.js';
import { PrivacyService } from './privacy/privacy.service.js';
import { AdminOperationsController } from './operations/operations.controller.js';
import { OperationsService } from './operations/operations.service.js';
import { HttpMetrics } from './observability/http-metrics.js';
import { MetricsController } from './observability/metrics.controller.js';
import { MeService } from './me/me.service.js';
import { ReferenceController } from './reference/reference.controller.js';

export interface AppModuleOptions {
  env: ApiEnv;
  /** Test seam: replace real dependency probes. */
  probes?: DependencyProbe[];
  /** Test seam: a controllable clock. */
  clock?: Clock;
  /** Test seam: capture outbound messages. */
  notifier?: Notifier;
  /** Test seam: replace the Redis rate limiter. */
  rateLimiter?: RateLimiter;
  /** Redis key namespace for rate limits; tests use a unique one per run. */
  rateLimitNamespace?: string;
  /** Test seam: replace object storage. */
  storage?: ObjectStorage;
  /** Test seam: replace the malware scanner. */
  scanner?: MalwareScanner;
  /** Test seam: replace the payment provider. */
  paymentProvider?: PaymentProvider;
  /** Test seam: where the mock provider sends webhooks (default: POST to this API). */
  webhookSink?: WebhookSink;
}

@Module({})
export class AppModule {
  static forRoot({
    env,
    probes,
    clock,
    notifier,
    rateLimiter,
    rateLimitNamespace,
    storage,
    scanner,
    paymentProvider,
    webhookSink,
  }: AppModuleOptions): DynamicModule {
    const theClock = clock ?? systemClock;
    const provider =
      paymentProvider ??
      new MockPaymentProvider(
        env.PSP_WEBHOOK_SECRET,
        webhookSink ??
          httpWebhookSink(`${env.API_PUBLIC_URL.replace(/\/$/, '')}/webhooks/payments`, (error) =>
            console.error('mock webhook delivery failed', error),
          ),
        theClock,
      );
    const sessionStore = (audience: 'user' | 'admin') => ({
      provide: audience === 'user' ? USER_SESSIONS : ADMIN_SESSIONS,
      inject: [DB, ACCESS_TOKENS],
      useFactory: (db: Db, tokens: AccessTokens) =>
        new SessionStore(db, tokens, {
          audience,
          table: audience === 'user' ? 'sessions' : 'admin_sessions',
          subjectColumn: audience === 'user' ? 'user_id' : 'admin_id',
          accessTtlSeconds:
            audience === 'user' ? USER_ACCESS_TTL_SECONDS : ADMIN_ACCESS_TTL_SECONDS,
          refreshIdleSeconds:
            audience === 'user' ? USER_REFRESH_IDLE_SECONDS : ADMIN_REFRESH_IDLE_SECONDS,
          refreshAbsoluteSeconds:
            audience === 'user' ? USER_REFRESH_ABSOLUTE_SECONDS : ADMIN_REFRESH_ABSOLUTE_SECONDS,
        }),
    });
    return {
      module: AppModule,
      imports: [LoggerModule.forRoot(loggerParams(env))],
      controllers: [
        HealthController,
        MetricsController,
        ReferenceController,
        AuthController,
        MeController,
        PrivacyController,
        UnsubscribeController,
        AdminOperationsController,
        BusinessesController,
        AdminAuthController,
        AdminController,
        OnboardingController,
        AdminBusinessesController,
        AdminTaxonomyController,
        CatalogController,
        BusinessCatalogController,
        AdminProductsController,
        CommerceController,
        BookingsController,
        BusinessScheduleController,
        AdminBookingsController,
        BusinessHomeServicesController,
        AdminHomeServicesController,
        BusinessFinanceController,
        AdminFinanceController,
        AdminTaxController,
        BusinessDocumentsController,
        CustomerDocumentsController,
        PublicReviewsController,
        SupportInfoController,
        CustomerAftercareController,
        BusinessAftercareController,
        AdminAftercareController,
        WebhooksController,
        // The mock provider's hosted payment step. Production cannot run the mock (ADR-0006).
        ...(env.PSP_PROVIDER === 'mock' ? [MockPspController] : []),
        // Signed URLs of the local storage adapter are served by the API itself.
        ...(env.STORAGE_PROVIDER === 'local' ? [LocalStorageController] : []),
      ],
      providers: [
        { provide: API_ENV, useValue: env },
        { provide: HttpMetrics, useValue: new HttpMetrics() },
        Infrastructure,
        {
          provide: DEPENDENCY_PROBES,
          useFactory: (infra: Infrastructure) => probes ?? infra.probes(),
          inject: [Infrastructure],
        },
        { provide: DB, useFactory: (infra: Infrastructure) => infra.db, inject: [Infrastructure] },
        { provide: CLOCK, useValue: theClock },
        { provide: PAYMENT_PROVIDER, useValue: provider },
        { provide: NOTIFIER, useValue: notifier ?? new MockNotifier(env.APP_ENV !== 'test') },
        {
          provide: RATE_LIMITER,
          useFactory: (infra: Infrastructure) =>
            rateLimiter ??
            new RedisRateLimiter(infra.redis, rateLimitNamespace ?? env.APP_ENV, () =>
              infra.redisReady(),
            ),
          inject: [Infrastructure],
        },
        { provide: ACCESS_TOKENS, useValue: new AccessTokens(env.JWT_KEYS) },
        { provide: SECRET_BOX, useValue: new SecretBox(env.MFA_ENCRYPTION_KEY) },
        {
          provide: OBJECT_STORAGE,
          useValue:
            storage ??
            new LocalObjectStorage(
              env.STORAGE_LOCAL_DIR,
              env.STORAGE_SIGNING_SECRET,
              env.API_PUBLIC_URL,
            ),
        },
        { provide: MALWARE_SCANNER, useValue: scanner ?? new MockMalwareScanner() },
        sessionStore('user'),
        sessionStore('admin'),
        AuthService,
        MeService,
        PrivacyService,
        OperationsService,
        BusinessesService,
        AdminService,
        OnboardingService,
        AdminBusinessesService,
        TaxonomyService,
        StoresService,
        PublicProductsService,
        ProductsService,
        InventoryService,
        AdminProductsService,
        CartService,
        CheckoutService,
        OrdersService,
        PaymentsService,
        ScheduleService,
        BookingsService,
        AdminBookingsService,
        HomeServicesService,
        FinanceService,
        AdminFinanceService,
        TaxService,
        PayoutsService,
        ReconciliationService,
        FinanceScheduler,
        FulfillmentService,
        ReturnsService,
        ReviewsService,
        SupportService,
        NotificationsService,
        NotificationScheduler,
        DashboardsService,
        ExportsService,
        UserAuthGuard,
        OptionalUserAuthGuard,
        BusinessAccessGuard,
        AdminAuthGuard,
      ],
    };
  }
}
