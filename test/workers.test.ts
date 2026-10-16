// The mailer on Cloudflare: the shared contract with the Worker's own
// runtime (cloudflare:sockets, the EMAIL binding), and the Worker's entry
// as wrangler deploys it.
import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { cloudflareRuntime } from '../src/platform/cloudflare';
import { KEY, mailerContract } from './contract';

mailerContract('on Cloudflare', () => cloudflareRuntime(env));

it("the Worker's entry serves the same app, with its own key", async () => {
  expect(await (await SELF.fetch('https://mailer/health')).json()).toEqual({ status: 'healthy' });
  expect((await SELF.fetch('https://mailer/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
  const res = await SELF.fetch('https://mailer/send', { method: 'POST', headers: KEY, body: JSON.stringify({ message: { to: 'a@b.test', subject: 's' }, provider: { type: 'smtp' } }) });
  expect(await res.json()).toMatchObject({ code: 'invalid_config' });
});
