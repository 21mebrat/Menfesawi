import type { PayloadRequest } from 'payload'
import { fail } from '../library/coordination'
import { privateBody as body, privateEndpoint as endpoint } from '../privateEndpoints'
import {
  deleteMyBookmark,
  getMyBookmark,
  listMyBookmarks,
  saveBookmark,
  updateMyBookmarkNote,
} from './service'
import { isTargetType, readTarget } from './targets'

const id = (req: PayloadRequest) => String(req.routeParams?.id ?? '')
export const bookmarkEndpoints = [
  endpoint('post', '/mine', async (req) => {
    const { target, note } = await body(req, ['target', 'note'])
    if (note != null && typeof note !== 'string') return fail('Invalid note.')
    return saveBookmark(readTarget(target), { req, note })
  }),
  endpoint('get', '/mine', async (req) => {
    const params = new URL(req.url!).searchParams
    const type = params.get('targetType')
    if (type !== null && !isTargetType(type)) return fail('Unsupported bookmark type.')
    return listMyBookmarks({
      req,
      page: Number(params.get('page') ?? 1),
      limit: Number(params.get('limit') ?? 25),
      targetType: type ?? undefined,
    })
  }),
  endpoint('get', '/mine/:id', (req) => getMyBookmark(id(req), { req })),
  endpoint('patch', '/mine/:id', async (req) => {
    const { note } = await body(req, ['note'])
    if (note !== null && typeof note !== 'string') return fail('Supply a text note or null.')
    return updateMyBookmarkNote(id(req), note, { req })
  }),
  endpoint('delete', '/mine/:id', (req) => deleteMyBookmark(id(req), { req })),
]
