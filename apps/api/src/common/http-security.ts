import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Baseline HTTP hardening for the API.
 *
 * The API only ever answers JSON, so the policies below are deliberately
 * strict: nothing may be framed, sniffed, embedded or rendered as a document.
 * A request id is echoed (or generated) so a log line can be tied to the exact
 * request that produced it without trusting client-supplied prose.
 */
export function httpSecurity(options: { production: boolean }) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const incoming = request.headers['x-request-id'];
    const candidate = typeof incoming === 'string' ? incoming.trim() : '';
    const requestId = /^[A-Za-z0-9._-]{8,64}$/.test(candidate) ? candidate : randomUUID();

    response.setHeader('X-Request-Id', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );

    if (options.production) {
      response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  };
}
