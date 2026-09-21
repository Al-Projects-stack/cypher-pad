import { copyFileSync } from 'node:fs';

copyFileSync(new URL('./src/schema.sql', import.meta.url), new URL('./dist/schema.sql', import.meta.url));
