import { apiEnvSchema, parseEnv } from '@jays/config';
import { createApp } from './bootstrap.js';

const env = parseEnv(apiEnvSchema, process.env);
const app = await createApp({ env });
await app.listen(env.API_PORT);
