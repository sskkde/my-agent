import type { GenericHttpConfig, RequestTemplate, ParsedOpenApiSpec } from './generic-http-types.js'

interface OpenApiSpec {
  openapi?: string
  info?: { title?: string; version?: string }
  paths?: Record<string, Record<string, OpenApiOperation>>
  basePath?: string
  servers?: Array<{ url: string }>
}

interface OpenApiOperation {
  operationId?: string
  summary?: string
  description?: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
}

interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  schema?: Record<string, unknown>
  description?: string
}

interface OpenApiRequestBody {
  content?: Record<string, { schema?: Record<string, unknown> }>
  required?: boolean
}

const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
type SupportedMethod = (typeof SUPPORTED_METHODS)[number]

function isSupportedMethod(key: string): key is SupportedMethod {
  return SUPPORTED_METHODS.includes(key as SupportedMethod)
}

function toHttpMethod(method: SupportedMethod): RequestTemplate['method'] {
  return method.toUpperCase() as RequestTemplate['method']
}

function determineCategory(method: SupportedMethod): RequestTemplate['category'] {
  if (method === 'get') return 'read'
  if (method === 'post') return 'write'
  if (method === 'put' || method === 'patch') return 'write'
  if (method === 'delete') return 'execute'
  return 'execute'
}

function determineRiskLevel(method: SupportedMethod): RequestTemplate['riskLevel'] {
  if (method === 'get') return 'low'
  if (method === 'post') return 'medium'
  if (method === 'put' || method === 'patch') return 'medium'
  if (method === 'delete') return 'high'
  return 'medium'
}

function buildInputSchema(operation: OpenApiOperation): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const param of operation.parameters ?? []) {
    properties[param.name] = {
      type: (param.schema?.type as string) ?? 'string',
      ...(param.description && { description: param.description }),
      ...(param.in === 'path' && { in: 'path' }),
      ...(param.in === 'query' && { in: 'query' }),
      ...(param.in === 'header' && { in: 'header' }),
    }
    if (param.required) {
      required.push(param.name)
    }
  }

  if (operation.requestBody?.content?.['application/json']?.schema) {
    properties['body'] = operation.requestBody.content['application/json'].schema
    if (operation.requestBody.required) {
      required.push('body')
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
  }
}

export function parseOpenApiSpec(spec: unknown): ParsedOpenApiSpec {
  const warnings: string[] = []
  const openApi = spec as OpenApiSpec

  if (!openApi || typeof openApi !== 'object') {
    warnings.push('Invalid spec: not an object')
    return { config: { baseURL: '', requestTemplates: [] }, warnings }
  }

  if (!openApi.openapi?.startsWith('3.')) {
    warnings.push(`Unsupported OpenAPI version: ${openApi.openapi ?? 'missing'}. Only 3.x is supported.`)
  }

  let baseURL = ''
  if (openApi.servers && openApi.servers.length > 0) {
    baseURL = openApi.servers[0].url
  } else if (openApi.basePath) {
    baseURL = openApi.basePath
  }

  const templates: RequestTemplate[] = []

  if (openApi.paths) {
    for (const [pathStr, pathItem] of Object.entries(openApi.paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue

      for (const [methodKey, operation] of Object.entries(pathItem)) {
        if (!isSupportedMethod(methodKey)) continue
        if (!operation || typeof operation !== 'object') continue

        const operationId =
          operation.operationId ?? `${methodKey}_${pathStr.replace(/[{}]/g, '').replace(/^\//, '').replace(/\//g, '_')}`

        const template: RequestTemplate = {
          operationId,
          method: toHttpMethod(methodKey),
          path: pathStr,
          description: operation.summary ?? operation.description,
          category: determineCategory(methodKey),
          riskLevel: determineRiskLevel(methodKey),
        }

        const headerParams = (operation.parameters ?? []).filter((p: OpenApiParameter) => p.in === 'header')
        if (headerParams.length > 0) {
          const headers: Record<string, string> = {}
          for (const hp of headerParams) {
            headers[hp.name] = `{{${hp.name}}}`
          }
          template.headers = headers
        }

        templates.push(template)
      }
    }
  }

  if (templates.length === 0) {
    warnings.push('No paths found in OpenAPI spec')
  }

  const config: GenericHttpConfig = {
    baseURL,
    requestTemplates: templates,
  }

  return { config, warnings }
}

export { buildInputSchema }
