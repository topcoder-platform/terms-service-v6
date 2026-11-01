import 'reflect-metadata';
import { All, Controller, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Database } from './database.js';
import { Integrations } from './integrations.js';
import { TermsService } from './terms.service.js';
import { DocusignService } from './docusign.service.js';
import { TermsController } from './terms.controller.js';
import { AuthGuard } from './auth.js';
import { ErrorFilter } from './errors.js';
import { config } from './config.js';
import { FallbackController } from './fallback.controller.js';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { readFileSync } from 'node:fs';
@Controller()
class HealthController {
  @All([`${config.BASE_PATH}/terms/health`, `${config.BASE_PATH}/terms/health/{*rest}`]) health() { return { message: 'The service is up.' }; }
}
@Module({ controllers: [HealthController, TermsController, FallbackController], providers: [Database, Integrations, TermsService, DocusignService, AuthGuard] })
export class AppModule {}
export async function createApp() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.enableShutdownHooks();
  app.useGlobalFilters(new ErrorFilter());
  const express = app.getHttpAdapter().getInstance();
  express.set('query parser', 'extended');
  express.set('json escape', true);
  express.use((_req: unknown, res: any, next: () => void) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  const docs = YAML.parse(readFileSync(new URL('../docs/swagger.yaml', import.meta.url), 'utf8'));
  express.use(`${config.BASE_PATH}/terms/docs`, swaggerUi.serve, swaggerUi.setup(docs));
  await app.init();
  return app;
}
