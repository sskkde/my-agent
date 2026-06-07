import { createApiServer } from '../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js'
import type { FastifyInstance } from 'fastify'

export interface AuthenticatedTestContext {
  server: FastifyInstance
  baseUrl: string
  apiContext: ApiContext
  authCookie: string
}

export async function createAuthenticatedTestContext(dbPath: string = ':memory:'): Promise<AuthenticatedTestContext> {
  const ctx = createApiContext({ dbPath })
  if (isApiContextError(ctx)) {
    throw new Error(`Failed to create API context: ${ctx.message}`)
  }

  const apiContext = ctx
  const server = await createApiServer(apiContext)
  await server.listen({ port: 0 })
  const address = server.server.address()
  const baseUrl = `http://localhost:${(address as any).port}`

  const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testuser', password: 'testpassword123' }),
  })

  if (setupResponse.status !== 201) {
    throw new Error(`Failed to create test user: ${setupResponse.status}`)
  }

  const authCookie = setupResponse.headers.get('set-cookie')
  if (!authCookie) {
    throw new Error('No set-cookie header received from setup')
  }
  await setupResponse.text()

  return { server, baseUrl, apiContext, authCookie }
}

export async function closeAuthenticatedTestContext(context: AuthenticatedTestContext): Promise<void> {
  await context.server.close()
  if (context.apiContext && 'connection' in context.apiContext) {
    ;(context.apiContext as any).connection.close()
  }
}

export function createAuthenticatedFetch(baseUrl: string, authCookie: string) {
  return async (path: string, options: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    if (!headers['Cookie']) {
      headers['Cookie'] = authCookie
    }

    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    })
  }
}
