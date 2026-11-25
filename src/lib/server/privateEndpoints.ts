import { APIError, type Endpoint, type PayloadHandler, type PayloadRequest } from 'payload'
import { fail } from './library/coordination'
import { readLimitedBody } from './library/uploadRequest'

export async function privateBody(
  req: PayloadRequest,
  allowed: readonly string[],
): Promise<Record<string, unknown>> {
  if (req.headers.get('content-type')?.split(';')[0] !== 'application/json')
    return fail('JSON required.', 415)
  let data: unknown
  try {
    data = JSON.parse((await readLimitedBody(req, 32768)).toString('utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) return fail('Invalid JSON.')
    throw error
  }
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    Object.keys(data).some((k) => !allowed.includes(k))
  )
    return fail('Unexpected request fields.')
  return Object.fromEntries(Object.entries(data))
}
export function privateEndpoint(
  method: Endpoint['method'],
  path: string,
  work: (req: PayloadRequest) => Promise<unknown>,
): Endpoint {
  const handler: PayloadHandler = async (req) => {
    const headers = { 'cache-control': 'private, no-store' }
    try {
      if (!req.user) return fail('Sign in to access your account data.', 401)
      if (method !== 'get') {
        const origin = req.headers.get('origin')
        if (
          req.headers.get('sec-fetch-site') === 'cross-site' ||
          (origin && origin !== new URL(req.url!).origin)
        )
          return fail('Cross-site request denied.', 403)
      }
      const result = await work(req)
      return result === undefined
        ? new Response(null, { status: 204, headers })
        : Response.json(result, { headers })
    } catch (error) {
      if (error instanceof APIError)
        return Response.json({ error: error.message }, { status: error.status, headers })
      throw error
    }
  }
  return { method, path, handler }
}
