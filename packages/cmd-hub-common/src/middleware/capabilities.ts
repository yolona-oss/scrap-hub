/**
 * Capability keys published by the common-tier middlewares.
 *
 * Consumers (e.g. HTTP-client libraries that want a proxy) read these via
 * `app.get(CAP_HttpAgent)` instead of poking `app.context.httpAgent` by
 * string.
 */
import { defineCapability } from '../application/capability'

/** SOCKS or HTTPS proxy agent published by ProxyMiddleware. The concrete
 *  type is `unknown` here because the two agent packages ship different
 *  shapes and we don't want to pull either into @cmd-hub/common's deps.
 *  Consumers narrow per their own import. */
export const CAP_HttpAgent = defineCapability<unknown>('common.httpAgent')
