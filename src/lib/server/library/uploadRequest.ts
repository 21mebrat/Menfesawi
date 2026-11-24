import { fail } from './coordination'
export async function readLimitedBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit)
    return fail('Request exceeds the supported upload size.', 413)
  if (!request.body) return fail('Missing request body.')
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) {
        await reader.cancel()
        return fail('Request exceeds the supported upload size.', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}
