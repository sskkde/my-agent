/**
 * OpenAPI Route Coverage Test
 * Verifies routes in openapi.yaml match routes registered in code.
 * Reports stale docs (in spec but not code) and missing docs (in code but not spec).
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const OPENAPI_PATH = path.resolve(__dirname, '../../docs/api/openapi.yaml')
const ROUTES_DIR = path.resolve(__dirname, '../../src/api/routes')
const MIN_COVERAGE = 0.9

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]

interface RouteInfo {
  method: HttpMethod
  path: string
}

/**
 * Parse OpenAPI YAML to extract all paths and their methods.
 * Uses line-by-line parsing based on YAML indentation (2-space path, 4-space method).
 */
function extractOpenApiRoutes(yamlContent: string): RouteInfo[] {
  const routes: RouteInfo[] = []
  const lines = yamlContent.split('\n')

  let currentPath: string | null = null
  let inPathsSection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    if (trimmedLine === 'paths:') {
      inPathsSection = true
      continue
    }

    if (inPathsSection && line.startsWith('components:')) {
      inPathsSection = false
      break
    }

    if (!inPathsSection) continue

    if (line.startsWith('  /')) {
      currentPath = trimmedLine.replace(/:$/, '')
      continue
    }

    if (currentPath) {
      for (const method of HTTP_METHODS) {
        if (line.startsWith(`    ${method}:`)) {
          routes.push({ method, path: currentPath })
          break
        }
      }
    }
  }

  return routes
}

/**
 * Scan route files for registered routes:
 * - server.get('/api/v1/...', ...) and server.get<{ ... }>('/api/v1/...', ...)
 * - server.route({ method, url/path: '/api/v1/...' })
 */
function extractCodeRoutes(routesDir: string): RouteInfo[] {
  const routes: RouteInfo[] = []
  const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.ts'))

  for (const file of files) {
    const filePath = path.join(routesDir, file)
    const content = fs.readFileSync(filePath, 'utf-8')

    for (const method of HTTP_METHODS) {
      // server.get('/api/v1/...') / server.get<{...}>('/api/v1/...')
      const directRegex = new RegExp(
        `server\\.${method}\\s*(?:<[^>]*>\\s*)?\\(\\s*['"\`](${escapeRegex('/api/v1/')}[^'"\`]+)['"\`]`,
        'g',
      )
      let match
      while ((match = directRegex.exec(content)) !== null) {
        routes.push({ method, path: match[1] })
      }

      // server.route({ method: 'GET', url: '/api/v1/...' })
      const routeUrlRegex = new RegExp(
        `server\\.route\\s*\\(\\s*\\{[^}]*method:\\s*['"\`]${method}['"\`][^}]*url:\\s*['"\`](${escapeRegex('/api/v1/')}[^'"\`]+)['"\`]`,
        'gi',
      )
      while ((match = routeUrlRegex.exec(content)) !== null) {
        routes.push({ method, path: match[1] })
      }

      // server.route({ method: 'GET', path: '/api/v1/...' })
      const routePathRegex = new RegExp(
        `server\\.route\\s*\\(\\s*\\{[^}]*method:\\s*['"\`]${method}['"\`][^}]*path:\\s*['"\`](${escapeRegex('/api/v1/')}[^'"\`]+)['"\`]`,
        'gi',
      )
      while ((match = routePathRegex.exec(content)) !== null) {
        routes.push({ method, path: match[1] })
      }
    }
  }

  return routes
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Normalize path: convert :param (Fastify) to {param} (OpenAPI), lowercase.
 */
function normalizePath(p: string): string {
  return p.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}').toLowerCase()
}

function routeKey(route: RouteInfo): string {
  return `${route.method.toUpperCase()} ${normalizePath(route.path)}`
}

describe('OpenAPI Route Coverage', () => {
  it('should have >= 90% coverage between OpenAPI spec and code routes', () => {
    const openApiContent = fs.readFileSync(OPENAPI_PATH, 'utf-8')
    const openApiRoutes = extractOpenApiRoutes(openApiContent)
    const openApiRouteSet = new Set(openApiRoutes.map(routeKey))

    const codeRoutes = extractCodeRoutes(ROUTES_DIR)
    const codeRouteSet = new Set(codeRoutes.map(routeKey))

    const staleDocs: string[] = []
    for (const route of openApiRouteSet) {
      if (!codeRouteSet.has(route)) {
        staleDocs.push(route)
      }
    }

    const missingDocs: string[] = []
    for (const route of codeRouteSet) {
      if (!openApiRouteSet.has(route)) {
        missingDocs.push(route)
      }
    }

    const matchedCount = openApiRouteSet.size - staleDocs.length
    const coverage = openApiRouteSet.size > 0 ? matchedCount / openApiRouteSet.size : 1

    console.log('\n=== OpenAPI Route Coverage Report ===')
    console.log(`OpenAPI routes: ${openApiRouteSet.size}`)
    console.log(`Code routes: ${codeRouteSet.size}`)
    console.log(`Matched routes: ${matchedCount}`)
    console.log(`Coverage: ${(coverage * 100).toFixed(1)}%`)

    if (staleDocs.length > 0) {
      console.log('\n⚠️  Routes in OpenAPI but not in code (stale docs):')
      staleDocs.sort().forEach((r) => console.log(`  - ${r}`))
    }

    if (missingDocs.length > 0) {
      console.log('\n⚠️  Routes in code but not in OpenAPI (missing docs):')
      missingDocs.sort().forEach((r) => console.log(`  - ${r}`))
    }

    expect(coverage).toBeGreaterThanOrEqual(MIN_COVERAGE)
  })

  it('should have valid OpenAPI spec file', () => {
    expect(fs.existsSync(OPENAPI_PATH)).toBe(true)
    const content = fs.readFileSync(OPENAPI_PATH, 'utf-8')
    expect(content).toContain('openapi:')
    expect(content).toContain('paths:')
  })

  it('should have at least some routes registered', () => {
    const codeRoutes = extractCodeRoutes(ROUTES_DIR)
    expect(codeRoutes.length).toBeGreaterThan(10)
  })
})
