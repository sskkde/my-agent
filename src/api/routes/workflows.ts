import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { success, envelopeError } from '../response-envelope.js';
import { workflowDraftIdParamsSchema, workflowDefinitionIdParamsSchema, workflowRunIdParamsSchema } from '../schemas/shared.js';
import type {
  WorkflowDraft,
  WorkflowDefinition,
  WorkflowStep,
  ValidationIssue,
} from '../../workflows/types.js';
import type { WorkflowRun, WorkflowStepRun } from '../../storage/workflow-run-store.js';

interface CreateDraftRequest {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

interface UpdateDraftRequest {
  name?: string;
  description?: string;
  steps?: WorkflowStep[];
}

interface StartRunRequest {
  inputData?: Record<string, unknown>;
}

interface DraftResponse {
  draftId: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  ownerUserId: string;
  status: string;
  validationIssues: ValidationIssue[];
  createdAt: string;
  updatedAt: string;
}

interface DefinitionResponse {
  workflowId: string;
  name: string;
  description?: string;
  version: number;
  steps: WorkflowStep[];
  ownerUserId: string;
  status: string;
  publishedFromDraftId?: string;
  createdAt: string;
  updatedAt: string;
}

interface RunResponse {
  workflowRunId: string;
  definitionId: string;
  version: number;
  status: string;
  currentStepIds: string[];
  stepRuns: Array<{
    stepRunId: string;
    stepId: string;
    stepType: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
  }>;
}

interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

function mapDraftToResponse(draft: WorkflowDraft): DraftResponse {
  return {
    draftId: draft.draftId,
    name: draft.name,
    description: draft.description,
    steps: draft.steps,
    ownerUserId: draft.ownerUserId,
    status: draft.status,
    validationIssues: draft.validationIssues,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function mapDefinitionToResponse(definition: WorkflowDefinition): DefinitionResponse {
  return {
    workflowId: definition.workflowId,
    name: definition.name,
    description: definition.description,
    version: definition.version,
    steps: definition.steps,
    ownerUserId: definition.ownerUserId,
    status: definition.status,
    publishedFromDraftId: definition.publishedFromDraftId,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

function mapRunToResponse(
  run: WorkflowRun,
  stepRuns: WorkflowStepRun[]
): RunResponse {
  return {
    workflowRunId: run.workflowRunId,
    definitionId: run.workflowId,
    version: parseInt(run.workflowVersion, 10),
    status: run.status,
    currentStepIds: run.currentStepIds ?? [],
    stepRuns: stepRuns.map(sr => ({
      stepRunId: sr.stepRunId,
      stepId: sr.stepId,
      stepType: sr.stepType,
      status: sr.status,
      startedAt: sr.startedAt,
      completedAt: sr.completedAt,
    })),
  };
}

function validateSteps(steps: unknown): steps is WorkflowStep[] {
  if (!Array.isArray(steps)) {
    return false;
  }
  
  for (const step of steps) {
    if (!step || typeof step !== 'object') {
      return false;
    }
    if (typeof step.stepId !== 'string' || !step.stepId) {
      return false;
    }
    if (typeof step.stepType !== 'string' || !step.stepType) {
      return false;
    }
    if (typeof step.name !== 'string' || !step.name) {
      return false;
    }
  }
  
  return true;
}

export function registerWorkflowRoutes(server: FastifyInstance, context: ApiContext): void {
  const { workflowRuntime, stores } = context;
  const { workflowDraftStore, workflowDefinitionStore, workflowRunStore } = stores;

  // GET /api/workflows/drafts
  server.get(
    '/api/workflows/drafts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const drafts = workflowDraftStore.getDraftsByOwner(userId);
      const response = drafts.map(mapDraftToResponse);

      return reply.code(200).send(success(response, request.requestId));
    }
  );

  // GET /api/workflows/drafts/:draftId
  server.get<{ Params: { draftId: string } }>(
    '/api/workflows/drafts/:draftId',
    {
      schema: {
        params: workflowDraftIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { draftId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { draftId } = request.params;
      const draft = workflowDraftStore.getDraftById(draftId);

      if (!draft) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Draft not found', request.requestId));
      }

      if (draft.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Draft not found', request.requestId));
      }

      return reply.code(200).send(success(mapDraftToResponse(draft), request.requestId));
    }
  );

  // POST /api/workflows/drafts
  server.post<{ Body: CreateDraftRequest }>(
    '/api/workflows/drafts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'steps'],
          properties: {
            name: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            steps: { type: 'array' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateDraftRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { name, description, steps } = request.body;

      if (name.trim().length === 0) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'name is required and must be a non-empty string', request.requestId));
      }

      if (!validateSteps(steps)) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'steps is required and must be an array of valid workflow steps', request.requestId));
      }

      try {
        const draft = workflowRuntime.createDraft({
          name: name.trim(),
          description: description?.trim(),
          steps,
          ownerUserId: userId,
        });

        return reply.code(201).send(success(mapDraftToResponse(draft), request.requestId));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create draft';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId));
      }
    }
  );

  // PATCH /api/workflows/drafts/:draftId
  server.patch<{ Params: { draftId: string }; Body: UpdateDraftRequest }>(
    '/api/workflows/drafts/:draftId',
    {
      schema: {
        params: workflowDraftIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { draftId: string }; Body: UpdateDraftRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { draftId } = request.params;
      const existingDraft = workflowDraftStore.getDraftById(draftId);

      if (!existingDraft) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Draft not found', request.requestId));
      }

      if (existingDraft.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Draft not found', request.requestId));
      }

      const { name, description, steps } = request.body || {};

      if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'name must be a non-empty string', request.requestId));
      }

      if (steps !== undefined && !validateSteps(steps)) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'steps must be an array of valid workflow steps', request.requestId));
      }

      const updates: Partial<Pick<WorkflowDraft, 'name' | 'description' | 'steps'>> = {};
      if (name !== undefined) updates.name = name.trim();
      if (description !== undefined) updates.description = description?.trim();
      if (steps !== undefined) updates.steps = steps;

      if (Object.keys(updates).length === 0) {
        return reply.code(200).send(success(mapDraftToResponse(existingDraft), request.requestId));
      }

      try {
        const updated = workflowDraftStore.updateDraft(draftId, updates);
        if (!updated) {
          return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to update draft', request.requestId));
        }

        return reply.code(200).send(success(mapDraftToResponse(updated), request.requestId));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update draft';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId));
      }
    }
  );

  // POST /api/workflows/drafts/:draftId/validate
  server.post<{ Params: { draftId: string } }>(
    '/api/workflows/drafts/:draftId/validate',
    {
      schema: {
        params: workflowDraftIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { draftId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { draftId } = request.params;
      const existingDraft = workflowDraftStore.getDraftById(draftId);

      if (!existingDraft) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Draft not found', request.requestId));
      }

      if (existingDraft.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Draft not found', request.requestId));
      }

      try {
        const issues = workflowRuntime.validateDraft(draftId);
        const result: ValidationResult = {
          valid: issues.length === 0,
          issues,
        };

        return reply.code(200).send(success(result, request.requestId));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to validate draft';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId));
      }
    }
  );

  // POST /api/workflows/drafts/:draftId/publish
  server.post<{ Params: { draftId: string } }>(
    '/api/workflows/drafts/:draftId/publish',
    {
      schema: {
        params: workflowDraftIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { draftId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { draftId } = request.params;
      const existingDraft = workflowDraftStore.getDraftById(draftId);

      if (!existingDraft) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Draft not found', request.requestId));
      }

      if (existingDraft.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Draft not found', request.requestId));
      }

      try {
        const definition = workflowRuntime.publishDraft(draftId);
        return reply.code(201).send(success(mapDefinitionToResponse(definition), request.requestId));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to publish draft';
        if (errorMessage.includes('validation issues')) {
          return reply.code(400).send(envelopeError('BAD_REQUEST', errorMessage, request.requestId));
        }
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId));
      }
    }
  );

  // DELETE /api/workflows/drafts/:draftId
  server.delete<{ Params: { draftId: string } }>(
    '/api/workflows/drafts/:draftId',
    {
      schema: {
        params: workflowDraftIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { draftId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { draftId } = request.params;
      const existingDraft = workflowDraftStore.getDraftById(draftId);

      if (!existingDraft) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Draft not found', request.requestId));
      }

      if (existingDraft.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Draft not found', request.requestId));
      }

      try {
        const deleted = workflowDraftStore.deleteDraft(draftId);
        if (!deleted) {
          return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to delete draft', request.requestId));
        }

        return reply.code(204).send();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete draft';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId));
      }
    }
  );

  // GET /api/workflows/definitions
  server.get(
    '/api/workflows/definitions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const definitions = workflowDefinitionStore.getDefinitionsByOwner(userId);
      const response = definitions.map(mapDefinitionToResponse);

      return reply.code(200).send(success(response, request.requestId));
    }
  );

  // GET /api/workflows/definitions/:workflowId
  server.get<{ Params: { workflowId: string } }>(
    '/api/workflows/definitions/:workflowId',
    {
      schema: {
        params: workflowDefinitionIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { workflowId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { workflowId } = request.params;
      const definition = workflowDefinitionStore.getDefinitionById(workflowId);

      if (!definition) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workflow definition not found', request.requestId));
      }

      if (definition.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workflow definition not found', request.requestId));
      }

      return reply.code(200).send(success(mapDefinitionToResponse(definition), request.requestId));
    }
  );

  // POST /api/workflows/runs
  server.post<{ Body: StartRunRequest & { definitionId: string } }>(
    '/api/workflows/runs',
    {
      schema: {
        body: {
          type: 'object',
          required: ['definitionId'],
          properties: {
            definitionId: { type: 'string', minLength: 1 },
            inputData: { type: 'object' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: StartRunRequest & { definitionId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { definitionId, inputData } = request.body;

      if (!definitionId) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'definitionId is required', request.requestId));
      }

      const definition = workflowDefinitionStore.getDefinitionById(definitionId);

      if (!definition) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workflow definition not found', request.requestId));
      }

      if (definition.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workflow definition not found', request.requestId));
      }

      try {
        const result = workflowRuntime.startWorkflowRun({
          definitionId,
          inputData,
          userId,
        });

        const run = workflowRunStore.getWorkflowRunById(result.workflowRunId);
        const stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId);

        if (!run) {
          return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to retrieve created run', request.requestId));
        }

        return reply.code(201).send(success(mapRunToResponse(run, stepRuns), request.requestId));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to start workflow run';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId));
      }
    }
  );

  // GET /api/workflows/runs/:workflowRunId
  server.get<{ Params: { workflowRunId: string } }>(
    '/api/workflows/runs/:workflowRunId',
    {
      schema: {
        params: workflowRunIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { workflowRunId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { workflowRunId } = request.params;
      const run = workflowRunStore.getWorkflowRunById(workflowRunId);

      if (!run) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workflow run not found', request.requestId));
      }

      if (run.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workflow run not found', request.requestId));
      }

      const stepRuns = workflowRunStore.getStepsByWorkflowRunId(workflowRunId);

      return reply.code(200).send(success(mapRunToResponse(run, stepRuns), request.requestId));
    }
  );

  // GET /api/workflows/runs (list all)
  server.get(
    '/api/workflows/runs',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const definitions = workflowDefinitionStore.getDefinitionsByOwner(userId);
      const allRuns: Array<{ run: WorkflowRun; stepRuns: WorkflowStepRun[] }> = [];

      for (const def of definitions) {
        const runs = workflowRunStore.getWorkflowRunsByWorkflow(def.workflowId);
        for (const run of runs) {
          const stepRuns = workflowRunStore.getStepsByWorkflowRunId(run.workflowRunId);
          allRuns.push({ run, stepRuns });
        }
      }

      allRuns.sort((a, b) => {
        const aTime = a.run.startedAt ? new Date(a.run.startedAt).getTime() : 0;
        const bTime = b.run.startedAt ? new Date(b.run.startedAt).getTime() : 0;
        return bTime - aTime;
      });

      const response = allRuns.map(({ run, stepRuns }) => mapRunToResponse(run, stepRuns));

      return reply.code(200).send(success(response, request.requestId));
    }
  );
}
