/**
 * Shared test helpers.
 *
 * @module dsh-bioinf-verify/tests/helpers
 */

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
