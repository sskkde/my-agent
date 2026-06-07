import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'

describe('Response Compression', () => {
  let ctx: AuthenticatedTestContext
  let baseUrl: string

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext()
    baseUrl = ctx.baseUrl
  }, 30000)

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx)
  }, 30000)

  it('should return gzip compressed response when Accept-Encoding: gzip', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'Accept-Encoding': 'gzip' },
    })
    expect(response.status).toBe(200)
    const contentEncoding = response.headers.get('content-encoding')
    expect(contentEncoding).toBe('gzip')
  })

  it('should return uncompressed response without Accept-Encoding', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'Accept-Encoding': 'identity' },
    })
    expect(response.status).toBe(200)
    const contentEncoding = response.headers.get('content-encoding')
    expect(contentEncoding).toBeNull()
  })
})
