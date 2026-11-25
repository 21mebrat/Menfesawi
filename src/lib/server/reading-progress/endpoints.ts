import type { PayloadRequest } from 'payload'
import { privateBody, privateEndpoint } from '../privateEndpoints'
import { fail } from '../library/coordination'
import {
  getMyReadingProgress,
  listMyReadingProgress,
  resetMyReadingProgress,
  saveMyReadingProgress,
} from './service'
import { isID } from '../bookmarks/targets'

function query(req: PayloadRequest, allowed: string[] = []) {
  const params = new URL(req.url!).searchParams
  for (const key of params.keys()) {
    if (
      !['locale', 'fallbackLocale', 'fallback-locale', ...allowed].includes(key) ||
      params.getAll(key).length !== 1
    )
      return fail('Unexpected reading progress query parameter.')
  }
  return params
}
async function writeBody(
  req: PayloadRequest,
  fields: string[],
): Promise<Record<string, unknown> & { expectedRevision: number }> {
  if (!req.body) return fail('Supply the expected progress revision.', 409)
  const data = await privateBody(req, ['expectedRevision', ...fields])
  if (typeof data.expectedRevision !== 'number')
    return fail('Supply the expected progress revision.', 409)
  return { ...data, expectedRevision: data.expectedRevision }
}
export const progressEndpoints = [
  privateEndpoint('get', '/mine', (req) => {
    const params = query(req, ['page', 'limit'])
    return listMyReadingProgress({
      req,
      page: Number(params.get('page') ?? 1),
      limit: Number(params.get('limit') ?? 25),
    })
  }),
  privateEndpoint('get', '/mine/:publication', (req) => {
    query(req)
    return getMyReadingProgress(String(req.routeParams?.publication), { req })
  }),
  privateEndpoint('put', '/mine/:publication', async (req) => {
    query(req)
    const { expectedRevision, section, passage, generation } = await writeBody(req, [
      'section',
      'passage',
      'generation',
    ])
    if (generation !== undefined && !isID(generation))
      return fail('Invalid progress generation. Refetch the saved position.', 409)
    if (!isID(section) || (passage != null && !isID(passage)))
      return fail('Invalid section or passage.')
    return saveMyReadingProgress(
      { publication: String(req.routeParams?.publication), section, passage },
      { expectedRevision, generation },
      { req },
    )
  }),
  privateEndpoint('delete', '/mine/:generation', async (req) => {
    query(req)
    const { expectedRevision } = await writeBody(req, [])
    return resetMyReadingProgress(
      null,
      { generation: String(req.routeParams?.generation), expectedRevision },
      { req },
    )
  }),
]
