import { createApp } from './app.js';
import { config } from './config.js';
import { validateRuntimeConfig } from './runtime-config.js';
validateRuntimeConfig();
const app = await createApp();
await app.listen(Number(config.PORT), '0.0.0.0');
