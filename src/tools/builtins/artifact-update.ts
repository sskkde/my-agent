import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js'
import type { ArtifactStore, ArtifactType } from '../../storage/artifact-store.js'

export interface ArtifactUpdateParams {
  artifactId: string
  title?: string
  content?: string
  artifactType?: ArtifactType
}

export interface ArtifactUpdateResult {
  artifactId: string
  name: string
  artifactType: ArtifactType
  status: string
  updatedAt: string
  [key: string]: unknown
}

export function createArtifactUpdateTool(artifactStore: ArtifactStore): ToolDefinition {
  const handler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as ArtifactUpdateParams

    if (!typedParams.artifactId) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: artifactId',
          recoverable: true,
        },
      }
    }

    const artifact = artifactStore.findByArtifactId(typedParams.artifactId)

    if (!artifact) {
      return {
        success: false,
        error: {
          code: 'ARTIFACT_NOT_FOUND',
          message: `Artifact with ID ${typedParams.artifactId} not found`,
          recoverable: false,
        },
      }
    }

    const updateData: Partial<Parameters<ArtifactStore['update']>[1]> = {}

    if (typedParams.title) {
      updateData.name = typedParams.title
    }

    if (typedParams.content) {
      updateData.contentSummary = typedParams.content.slice(0, 200)
    }

    if (typedParams.artifactType) {
      updateData.artifactType = typedParams.artifactType
    }

    const updated = artifactStore.update(artifact.id, updateData)

    if (!updated) {
      return {
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: 'Failed to update artifact',
          recoverable: true,
        },
      }
    }

    const result: ArtifactUpdateResult = {
      artifactId: updated.artifactId,
      name: updated.name,
      artifactType: updated.artifactType,
      status: updated.status,
      updatedAt: updated.updatedAt,
    }

    return {
      success: true,
      data: result,
      resultPreview: `Updated artifact "${updated.name}" (${updated.artifactId})`,
      structuredContent: result,
    }
  }

  return {
    name: 'artifact_update',
    description: 'Update an existing artifact by artifactId',
    category: 'write',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: 'ID of the artifact to update (starts with art_)' },
        title: { type: 'string', description: 'New title of the artifact' },
        content: { type: 'string', description: 'New content of the artifact' },
        artifactType: {
          type: 'string',
          enum: ['document', 'draft', 'image', 'report', 'spreadsheet', 'code', 'workflow'],
          description: 'New type of the artifact',
        },
      },
      required: ['artifactId'],
    },
    handler,
  }
}
