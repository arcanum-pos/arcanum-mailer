import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// The same contract on both runtimes (SELF_HOSTING.md): on Cloudflare in
// the Workers runtime (workers.test.ts), self-hosted on Node (node.test.ts).
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: { bindings: { MAILER_INTERNAL_KEY: 'test-mailer-key' } },
          }),
        ],
        test: { name: 'cloudflare', include: ['test/workers.test.ts', 'test/properties.test.ts'] },
      },
      {
        test: { name: 'node', environment: 'node', include: ['test/node.test.ts'] },
      },
    ],
  },
});
