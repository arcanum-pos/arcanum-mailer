// The mailer on a Cloudflare Worker: its socket is cloudflare:sockets'
// connect(), and Cloudflare Email Service is the EMAIL binding.
import { connect } from 'cloudflare:sockets';
import type { Env } from '../env';
import type { Connect, Runtime } from './types';

export const cloudflareConnect: Connect = (address, options) => connect(address, options);

export function cloudflareRuntime(env: Env): Runtime {
  return { internalKey: env.MAILER_INTERNAL_KEY, connect: cloudflareConnect, email: env.EMAIL };
}
