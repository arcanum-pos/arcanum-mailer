// arcanum-mailer on Cloudflare (wrangler.jsonc's main). The app itself is
// app.ts; self-hosted, node.ts runs the same app.
import { createApp } from './app';
import type { Env } from './env';
import { cloudflareRuntime } from './platform/cloudflare';

export { handleSend, readRequest } from './app';

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    return createApp(cloudflareRuntime(env)).fetch(request);
  },
};
