import { createApp } from './app.js';
import { config } from './config.js';
const app = await createApp();
await app.listen(Number(config.PORT), '0.0.0.0');
