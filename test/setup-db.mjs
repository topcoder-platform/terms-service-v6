import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
const url = new URL(process.env.POSTGRES_URL || '');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/terms_contract_test') throw new Error('Only a local terms_contract_test database may be initialized');
const db = new Client({ connectionString: url.toString() });
await db.connect();
await db.query(await readFile(new URL('schema.sql', import.meta.url), 'utf8'));
await db.end();
