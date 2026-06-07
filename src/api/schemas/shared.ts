export const paginationQuerySchema = {
  type: 'object' as const,
  properties: {
    limit: { type: 'integer' as const, minimum: 1, maximum: 200, default: 50 },
    offset: { type: 'integer' as const, minimum: 0, default: 0 },
  },
}

export const sessionIdParamsSchema = {
  type: 'object' as const,
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string' as const, minLength: 1 },
  },
}

export const approvalIdParamsSchema = {
  type: 'object' as const,
  required: ['approvalId'],
  properties: {
    approvalId: { type: 'string' as const, minLength: 1 },
  },
}

export const providerIdParamsSchema = {
  type: 'object' as const,
  required: ['providerId'],
  properties: {
    providerId: { type: 'string' as const, minLength: 1 },
  },
}

export const agentIdParamsSchema = {
  type: 'object' as const,
  required: ['agentId'],
  properties: {
    agentId: { type: 'string' as const, minLength: 1 },
  },
}

export const connectorIdParamsSchema = {
  type: 'object' as const,
  required: ['id'],
  properties: {
    id: { type: 'string' as const, minLength: 1 },
  },
}

export const workflowDraftIdParamsSchema = {
  type: 'object' as const,
  required: ['draftId'],
  properties: {
    draftId: { type: 'string' as const, minLength: 1 },
  },
}

export const workflowDefinitionIdParamsSchema = {
  type: 'object' as const,
  required: ['workflowId'],
  properties: {
    workflowId: { type: 'string' as const, minLength: 1 },
  },
}

export const workflowRunIdParamsSchema = {
  type: 'object' as const,
  required: ['workflowRunId'],
  properties: {
    workflowRunId: { type: 'string' as const, minLength: 1 },
  },
}

export const scheduleIdParamsSchema = {
  type: 'object' as const,
  required: ['scheduleId'],
  properties: {
    scheduleId: { type: 'string' as const, minLength: 1 },
  },
}

export const webhookIdParamsSchema = {
  type: 'object' as const,
  required: ['webhookId'],
  properties: {
    webhookId: { type: 'string' as const, minLength: 1 },
  },
}

export const memoryIdParamsSchema = {
  type: 'object' as const,
  required: ['memoryId'],
  properties: {
    memoryId: { type: 'string' as const, minLength: 1 },
  },
}

export const nameBodySchema = {
  type: 'object' as const,
  required: ['name'],
  properties: {
    name: { type: 'string' as const, minLength: 1 },
  },
}
