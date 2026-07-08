import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { GoldenCase } from './golden-case-types.js'
import { validateOutputContractContent } from '../contracts/output-contract-validator.js'

export interface GoldenCaseDiff {
  path: string
  expected: unknown
  actual: unknown
  message: string
}

export interface GoldenCaseResult {
  caseId: string
  passed: boolean
  diffs: GoldenCaseDiff[]
}

export interface RunGoldenCaseOptions {
  builder: ModelInputBuilder
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export async function runGoldenCase(
  goldenCase: GoldenCase,
  options: RunGoldenCaseOptions,
): Promise<GoldenCaseResult> {
  const { builder } = options
  const { input, expectations } = goldenCase
  const diffs: GoldenCaseDiff[] = []

  const result = await builder.build({
    mode: input.mode,
    agentType: input.agentType,
    agentProfile: input.agentProfile,
    providerFamily: input.providerFamily,
    outputContract: input.outputContract,
    currentUserMessage: input.currentUserMessage,
    toolProjection: input.toolProjection,
    contextBundle: input.contextBundle as Record<string, unknown> | undefined,
  })

  if (expectations.expectedTools) {
    const missing = expectations.expectedTools.filter(
      (t) => !(input.toolProjection?.toolIds ?? []).includes(t),
    )
    if (missing.length > 0) {
      diffs.push({
        path: 'expectedTools',
        expected: expectations.expectedTools,
        actual: input.toolProjection?.toolIds ?? [],
        message: `Missing expected tools: ${missing.join(', ')}`,
      })
    }
  }

  if (expectations.forbiddenTools) {
    const present = expectations.forbiddenTools.filter(
      (t) => (input.toolProjection?.toolIds ?? []).includes(t),
    )
    if (present.length > 0) {
      diffs.push({
        path: 'forbiddenTools',
        expected: expectations.forbiddenTools,
        actual: input.toolProjection?.toolIds ?? [],
        message: `Forbidden tools present: ${present.join(', ')}`,
      })
    }
  }

  if (expectations.expectedSegmentHashes) {
    const hashes = result.segmentHashes as unknown as Record<string, string>
    const exp = expectations.expectedSegmentHashes as unknown as Record<string, string>
    for (const [key, expectedHash] of Object.entries(exp)) {
      const actualHash = hashes[key]
      if (actualHash !== expectedHash) {
        diffs.push({
          path: `segmentHash.${key}`,
          expected: expectedHash,
          actual: actualHash,
          message: `Segment hash mismatch for ${key}`,
        })
      }
    }
  }

  if (expectations.maxTokenEstimate !== undefined) {
    const totalText = [
      result.segments.staticPrefix,
      result.segments.tenantProject,
      result.segments.toolPlane,
      result.segments.contextBundle,
    ].join('')
    const estimated = estimateTokens(totalText)
    if (estimated > expectations.maxTokenEstimate) {
      diffs.push({
        path: 'maxTokenEstimate',
        expected: expectations.maxTokenEstimate,
        actual: estimated,
        message: `Token estimate ${estimated} exceeds max ${expectations.maxTokenEstimate}`,
      })
    }
  }

  if (expectations.outputContractMustValidate && input.outputContract) {
    const validation = validateOutputContractContent({
      contractId: input.outputContract,
      mode: input.mode,
      content: result.messages.map((m) => m.content).join('\n'),
    })
    if (!validation.ok) {
      diffs.push({
        path: 'outputContract',
        expected: 'valid',
        actual: validation.code,
        message: `Output contract validation failed: ${validation.code}`,
      })
    }
  }

  return {
    caseId: goldenCase.id,
    passed: diffs.length === 0,
    diffs,
  }
}
