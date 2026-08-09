import type { ModelInputMode } from '../kernel/model-input/model-input-types.js'

export type OutputContractKind = 'natural_language' | 'structured_json'

export type StructuredOutputErrorCode = 'INVALID_JSON' | 'SCHEMA_MISMATCH' | 'UNKNOWN_OUTPUT_CONTRACT'

export interface OutputContractDefinition {
  readonly contractId: string
  readonly kind: OutputContractKind
  readonly description: string
}

export interface OutputContractValidationInput {
  readonly contractId?: string
  readonly mode: ModelInputMode
  readonly content: string
}

export interface OutputContractValidationSuccess {
  readonly ok: true
  readonly contractId?: string
  readonly kind: OutputContractKind | 'none'
  readonly parsed?: unknown
  readonly skippedReason?: 'no_contract' | 'natural_language_contract' | 'non_structured_mode'
}

export interface OutputContractValidationFailure {
  readonly ok: false
  readonly contractId?: string
  readonly kind?: OutputContractKind
  readonly code: StructuredOutputErrorCode
  readonly message: string
  readonly details: readonly string[]
}

export type OutputContractValidationResult = OutputContractValidationSuccess | OutputContractValidationFailure

export class StructuredOutputContractError extends Error {
  readonly code: StructuredOutputErrorCode
  readonly contractId?: string
  readonly details: readonly string[]

  constructor(result: OutputContractValidationFailure) {
    super(result.message)
    this.name = 'StructuredOutputContractError'
    this.code = result.code
    this.contractId = result.contractId
    this.details = result.details
  }
}

const CONTRACTS = new Map<string, OutputContractDefinition>([
  [
    'output:default-chat.schema',
    {
      contractId: 'output:default-chat.schema',
      kind: 'natural_language',
      description: 'Default conversational markdown response',
    },
  ],
  [
    'output:search-evidence.schema',
    {
      contractId: 'output:search-evidence.schema',
      kind: 'natural_language',
      description: 'Search answer synthesis response; structured evidence is produced by the search tool result',
    },
  ],
  [
    'output:memory-candidate.schema',
    {
      contractId: 'output:memory-candidate.schema',
      kind: 'structured_json',
      description: 'Memory extraction candidates envelope',
    },
  ],
  [
    'output:planner.schema',
    {
      contractId: 'output:planner.schema',
      kind: 'structured_json',
      description: 'Execution plan envelope',
    },
  ],
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

function requireString(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== 'string' || (record[key] as string).length === 0) {
    errors.push(`${path}.${key} must be a string`)
  }
}

function requireNumber(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) {
    errors.push(`${path}.${key} must be a number`)
  }
}

function validateMemoryCandidateEnvelope(value: unknown): readonly string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ['root must be an object']
  }

  if (!Array.isArray(value.candidates)) {
    return ['candidates must be an array']
  }

  value.candidates.forEach((candidate, index) => {
    const path = `candidates[${index}]`
    if (!isRecord(candidate)) {
      errors.push(`${path} must be an object`)
      return
    }

    requireString(candidate, 'memoryType', path, errors)
    requireString(candidate, 'text', path, errors)
    requireNumber(candidate, 'confidence', path, errors)
    requireString(candidate, 'importance', path, errors)
    requireString(candidate, 'sensitivity', path, errors)

    if (!isStringArray(candidate.keywords)) {
      errors.push(`${path}.keywords must be a non-empty string array`)
    }

    if (!isRecord(candidate.scope) || candidate.scope.visibility !== 'private_user') {
      errors.push(`${path}.scope.visibility must be private_user`)
    }

    if (!isRecord(candidate.sourceRefs)) {
      errors.push(`${path}.sourceRefs must be an object`)
    } else if (!isStringArray(candidate.sourceRefs.transcriptRefs)) {
      errors.push(`${path}.sourceRefs.transcriptRefs must be a non-empty string array`)
    }

    if (candidate.entities !== undefined && !Array.isArray(candidate.entities)) {
      errors.push(`${path}.entities must be an array when provided`)
    }

    if (candidate.structured !== undefined && !isRecord(candidate.structured)) {
      errors.push(`${path}.structured must be an object when provided`)
    }

    if (candidate.discardReason !== undefined && typeof candidate.discardReason !== 'string') {
      errors.push(`${path}.discardReason must be a string when provided`)
    }
  })

  return errors
}

function validatePlannerEnvelope(value: unknown): readonly string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ['root must be an object']
  }

  requireString(value, 'id', 'plan', errors)
  requireString(value, 'goal', 'plan', errors)
  if (!Array.isArray(value.steps)) {
    errors.push('plan.steps must be an array')
  }
  if (typeof value.createdAt !== 'string') {
    errors.push('plan.createdAt must be a string')
  }
  if (typeof value.updatedAt !== 'string') {
    errors.push('plan.updatedAt must be a string')
  }
  if (typeof value.version !== 'number') {
    errors.push('plan.version must be a number')
  }

  return errors
}

function validateParsedContract(contractId: string, parsed: unknown): readonly string[] {
  switch (contractId) {
    case 'output:memory-candidate.schema':
      return validateMemoryCandidateEnvelope(parsed)
    case 'output:planner.schema':
      return validatePlannerEnvelope(parsed)
    default:
      return [`no validator registered for ${contractId}`]
  }
}

export function getOutputContractDefinition(contractId: string | undefined): OutputContractDefinition | undefined {
  if (!contractId) return undefined
  return CONTRACTS.get(contractId)
}

export function validateOutputContractContent(input: OutputContractValidationInput): OutputContractValidationResult {
  if (!input.contractId) {
    return { ok: true, kind: 'none', skippedReason: 'no_contract' }
  }

  const definition = getOutputContractDefinition(input.contractId)
  if (!definition) {
    return {
      ok: false,
      contractId: input.contractId,
      code: 'UNKNOWN_OUTPUT_CONTRACT',
      message: `Unknown output contract: ${input.contractId}`,
      details: [`${input.contractId} is not registered`],
    }
  }

  if (definition.kind === 'natural_language') {
    return {
      ok: true,
      contractId: definition.contractId,
      kind: definition.kind,
      skippedReason: 'natural_language_contract',
    }
  }

  if (input.mode !== 'structured_json') {
    return {
      ok: true,
      contractId: definition.contractId,
      kind: definition.kind,
      skippedReason: 'non_structured_mode',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input.content)
  } catch (error) {
    return {
      ok: false,
      contractId: definition.contractId,
      kind: definition.kind,
      code: 'INVALID_JSON',
      message: `Output for ${definition.contractId} is not valid JSON`,
      details: [error instanceof Error ? error.message : String(error)],
    }
  }

  const details = validateParsedContract(definition.contractId, parsed)
  if (details.length > 0) {
    return {
      ok: false,
      contractId: definition.contractId,
      kind: definition.kind,
      code: 'SCHEMA_MISMATCH',
      message: `Output for ${definition.contractId} failed schema validation`,
      details,
    }
  }

  return {
    ok: true,
    contractId: definition.contractId,
    kind: definition.kind,
    parsed,
  }
}
