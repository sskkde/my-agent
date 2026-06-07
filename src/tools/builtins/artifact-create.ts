import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js'
import type { ArtifactStore, ArtifactType } from '../../storage/artifact-store.js'

export interface ArtifactCreateParams {
  title: string
  content: string
  artifactType?: ArtifactType
}

export interface ArtifactCreateResult {
  artifactId: string
  name: string
  artifactType: ArtifactType
  status: string
  createdAt: string
  [key: string]: unknown
}

export function createArtifactCreateTool(artifactStore: ArtifactStore): ToolDefinition {
  const handler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as ArtifactCreateParams

    if (!typedParams.title) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: title',
          recoverable: true,
        },
      }
    }

    if (!typedParams.content) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: content',
          recoverable: true,
        },
      }
    }

    const artifactId = `art_${crypto.randomUUID().replace(/-/g, '')}`
    const artifactType = typedParams.artifactType ?? 'document'
    const contentRef = `content://${artifactId}`

    const artifact = artifactStore.create({
      artifactId,
      artifactType,
      name: typedParams.title,
      contentRef,
      contentSummary: typedParams.content.slice(0, 200),
      userId: 'system',
      status: 'active',
      metadata: {
        contentLength: typedParams.content.length,
        createdByTool: true,
      },
    })

    const result: ArtifactCreateResult = {
      artifactId: artifact.artifactId,
      name: artifact.name,
      artifactType: artifact.artifactType,
      status: artifact.status,
      createdAt: artifact.createdAt,
    }

    return {
      success: true,
      data: result,
      resultPreview: `Created artifact "${artifact.name}" (${artifact.artifactId}) of type ${artifactType}`,
      structuredContent: result,
    }
  }

  return {
    name: 'artifact_create',
    description: 'Create a new artifact with the given title and content',
    category: 'write',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the artifact' },
        content: { type: 'string', description: 'Content of the artifact' },
        artifactType: {
          type: 'string',
          enum: ['document', 'draft', 'image', 'report', 'spreadsheet', 'code', 'workflow'],
          description: 'Type of the artifact',
        },
      },
      required: ['title', 'content'],
    },
    handler,
  }
}
