import { APIError, getPayload } from 'payload'
import config from '@/payload.config'
import { isStaff } from '@/access'
import { readLimitedBody } from '@/lib/server/library/uploadRequest'
import { beginLink, confirmLink, issueTicket } from '@/lib/server/library/handoff'
import { ingestBookPDF, WEB_PDF_LIMIT } from '@/lib/server/library/ingest'
import { publicBookReviews, publicBookStatistics } from '@/lib/server/library/statistics'
import { fail } from '@/lib/server/library/coordination'

type Context = { params: Promise<{ action: string }> }
const json = (result: unknown, status = 200) =>
  Response.json(result, { status, headers: { 'cache-control': 'no-store' } })
function errorResponse(err: unknown) {
  if (err instanceof APIError) return json({ error: err.message }, err.status)
  throw err
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { action } = await params
    const origin = request.headers.get('origin')
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== new URL(request.url).origin)
    )
      return fail('Cross-site request denied.', 403)
    const p = await getPayload({ config })
    const { user } = await p.auth({ headers: request.headers })
    if (!user) return fail('Sign in first.', 401)
    if (action === 'upload') {
      if (!isStaff(user)) return fail('Active staff required.', 403)
      const mime = request.headers.get('content-type')
      if (mime !== 'application/pdf') return fail('Send the raw PDF with application/pdf.', 415)
      let name: string
      try {
        name = decodeURIComponent(request.headers.get('x-filename') ?? '')
      } catch {
        return fail('Invalid filename.')
      }
      return json(
        await ingestBookPDF(p, user.id, name, await readLimitedBody(request, WEB_PDF_LIMIT), mime),
      )
    }
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
      return fail('JSON request required.', 415)
    if (action === 'link') return json(await beginLink(p, user.id))
    let body: unknown
    try {
      body = JSON.parse((await readLimitedBody(request, 4096)).toString('utf8'))
    } catch (error) {
      if (error instanceof SyntaxError) return fail('Invalid JSON.')
      throw error
    }
    if (
      action === 'confirm' &&
      body &&
      typeof body === 'object' &&
      'proof' in body &&
      typeof body.proof === 'string'
    )
      return json(await confirmLink(p, user.id, body.proof))
    if (
      action === 'ticket' &&
      body &&
      typeof body === 'object' &&
      'book' in body &&
      typeof body.book === 'string'
    )
      return json(await issueTicket(p, user.id, body.book))
    return fail('Unknown action or invalid request.')
  } catch (error) {
    return errorResponse(error)
  }
}
export async function GET(request: Request, { params }: Context) {
  try {
    const { action } = await params,
      query = new URL(request.url).searchParams,
      book = query.get('book')
    if (!book || !/^[a-f0-9]{24}$/.test(book)) return fail('Invalid book.')
    const p = await getPayload({ config })
    if (action === 'statistics') return json(await publicBookStatistics(p, book))
    if (action === 'reviews')
      return json(await publicBookReviews(p, book, Number(query.get('page') ?? 1)))
    return fail('Unknown action.', 404)
  } catch (error) {
    return errorResponse(error)
  }
}
