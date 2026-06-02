import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Repo root, matching WXT's `@/` path alias so tests can import app code the
// same way the source does (e.g. `@/lib/audit/export`).
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': root },
  },
});
