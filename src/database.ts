import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { config } from './config.js';

@Injectable()
export class Database extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: config.POSTGRES_URL, connectionTimeoutMillis: 10000 }, { schema: config.DB_SCHEMA_NAME }), transactionOptions: { maxWait: 10000, timeout: 120000 } });
  }
  async onModuleDestroy() { await this.$disconnect(); }
}

// The legacy driver parses PostgreSQL int8 as JSON numbers. Keep that wire contract.
export function wire<T>(value: T): any {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? Number(item) : item));
}
export function clear(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(wire(value)).filter(([, v]) => v !== null));
}
