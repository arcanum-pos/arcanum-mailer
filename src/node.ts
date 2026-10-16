// arcanum-mailer self-hosted (SELF_HOSTING.md): the same app as on
// Cloudflare (app.ts), served by Node. Settings from the environment:
//   MAILER_INTERNAL_KEY  the key every /send carries (required)
//   PORT                 to listen on (default 8080)
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { nodeRuntime } from './platform/node';

const port = Number(process.env.PORT || 8080);
serve({ fetch: createApp(nodeRuntime(process.env)).fetch, port }, () => console.log(`arcanum-mailer listening on :${port}`));
