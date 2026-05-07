import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { ApiErrorFactory } from '../errors.js';
import type {
  WorkflowDraft,
  WorkflowDefinition,
  WorkflowStep,
  ValidationIssue,
} from '../../workflows/types.js';
import type { WorkflowRun, WorkflowStepRun } from '../../storage/workflow-run-store.js';

// Request types
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

// Response types
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

// Helper functions
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

  // GET /api/workflows/drafts - List all drafts for current user
  server.get(
    '/api/workflows/drafts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const drafts = workflowDraftStore.getDraftsByOwner(userId);
      const response = drafts.map(mapDraftToResponse);

      return reply.code(200).send({ data: response });
    }
  );

  // GET /api/workflows/drafts/:draftId - Get a specific draft
  server.get<{ Params: { draftId: string } }>(
    '/api/workflows/drafts/:draftId',
    async (request: FastifyRequest<{ Params: { draftId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { draftId } = request.params;
      const draft = workflowDraftStore.getDraftById(draftId);

      if (!draft) {
        const error = ApiErrorFactory.notFound('Draft not found');
        return reply.code(404).send(error);
      }

      if (draft.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Draft not found');
        return reply.code(404).send(error);
      }

      return reply.code(200).send({ data: mapDraftToResponse(draft) });
    }
  );

  // POST /api/workflows/drafts - Create a new draft
  server.post<{ Body: CreateDraftRequest }>(
    '/api/workflows/drafts',
    async (request: FastifyRequest<{ Body: CreateDraftRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { name, description, steps } = request.body || {};

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        const error = ApiErrorFactory.badRequest('name is required and must be a non-empty string');
        return reply.code(400).send(error);
      }

      if (!validateSteps(steps)) {
        const error = ApiErrorFactory.badRequest('steps is required and must be an array of valid workflow steps');
        return reply.code(400).send(error);
      }

      try {
        const draft = workflowRuntime.createDraft({
          name: name.trim(),
          description: description?.trim(),
          steps,
          ownerUserId: userId,
        });

        return reply.code(201).send({ data: mapDraftToResponse(draft) });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create draft';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // PATCH /api/workflows/drafts/:draftId - Update a draft
  server.patch<{ Params: { draftId: string }; Body: UpdateDraftRequest }>(
    '/api/workflows/drafts/:draftId',
    async (request: FastifyRequest<{ Params: { draftId: string }; Body: UpdateDraftRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { draftId } = request.params;
      const existingDraft = workflowDraftStore.getDraftById(draftId);

      if (!existingDraft) {
        const error = ApiErrorFactory.notFound('Draft not found');
        return reply.code(404).send(error);
      }

      if (existingDraft.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Draft not found');
        return reply.code(404).send(error);
      }

      const { name, description, steps } = request.body || {};

      if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        const error = ApiErrorFactory.badRequest('name must be a non-empty string');
        return reply.code(400).send(error);
      }

      if (steps !== undefined && !validateSteps(steps)) {
        const error = ApiErrorFactory.badRequest('steps must be an array of valid workflow steps');
        return reply.code(400).send(error);
      }

      const updates: Partial<Pick<WorkflowDraft, 'name' | 'description' | 'steps'>> = {};
      if (name !== undefined) updates.name = name.trim();
      if (description !== undefined) updates.description = description?.trim();
      if (steps !== undefined) updates.steps = steps;

      if (Object.keys(updates).length === 0) {
        return reply.code(200).send({ data: mapDraftToResponse(existingDraft) });
      }

      try {
        const updated = workflowDraftStore.updateDraft(draftId, updates);
        if (!updated) {
          const error = ApiErrorFactory.internalError('Failed to update draft');
          return reply.code(500).send(error);
        }

        return reply.code(200).send({ data: mapDraftToResponse(updated) });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update draft';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // POST /api/workflows/drafts/:draftId/validate - Validate a draft
  server.post<{ Params: { draftId: string } }>(
    '/api/workflows/drafts/:draftId/validate',
    async (request: FastifyRequest<{ Params: { draftId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { draftId } = request.params;
      const existingDraft = workflowDraftStore.getDraftById(draftId);

      if (!existingDraft) {
        const error = ApiErrorFactory.notFound('Draft not found');
        return reply.code(404).send(error);
      }

      if (existingDraft.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Draft not found');
        return reply.code(404).send(error);
      }

      try {
        const issues = workflowRuntime.validateDraft(draftId);
        const result: ValidationResult = {
          valid: issues.length === 0,
          issues,
        };

        return reply.code(200).send({ data: result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to validate draft';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // POST /api/workflows/drafts/:draftId/publish - Publish a draft
  server.post<{ Params: { draftId: string } }>(
    '/api/workflows/drafts/:draftId/publish',
    async (request: FastifyRequest<{ Params: { draftId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { draftId } = request.params;
      const existingDraft = workflowDraftStore.getDraftById(draftId);

      if (!existingDraft) {
        const error = ApiErrorFactory.notFound('Draft not found');
        return reply.code(404).send(error);
      }

      if (existingDraft.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Draft not found');
        return reply.code(404).send(error);
      }

      try {
        const definition = workflowRuntime.publishDraft(draftId);
        return reply.code(201).send({ data: mapDefinitionToResponse(definition) });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to publish draft';
        if (errorMessage.includes('validation issues')) {
          const apiError = ApiErrorFactory.badRequest(errorMessage);
          return reply.code(400).send(apiError);
        }
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // DELETE /api/workflows/drafts/:draftId - Delete a draft
  server.delete<{ Params: { draftId: string } }>(
    '/api/workflows/drafts/:draftId',
    async (request: FastifyRequest<{ Params: { draftId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { draftId } = request.params;
      const existingDraft = workflowDraftStore.getDraftById(draftId);

      if (!existingDraft) {
        const error = ApiErrorFactory.notFound('Draft not found');
        return reply.code(404).send(error);
      }

      if (existingDraft.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Draft not found');
        return reply.code(404).send(error);
      }

      try {
        const deleted = workflowDraftStore.deleteDraft(draftId);
        if (!deleted) {
          const error = ApiErrorFactory.internalError('Failed to delete draft');
          return reply.code(500).send(error);
        }

        return reply.code(204).send();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete draft';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // GET /api/workflows/definitions - List all definitions for current user
  server.get(
    '/api/workflows/definitions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const definitions = workflowDefinitionStore.getDefinitionsByOwner(userId);
      const response = definitions.map(mapDefinitionToResponse);

      return reply.code(200).send({ data: response });
    }
  );

  // GET /api/workflows/definitions/:workflowId - Get a specific definition
  server.get<{ Params: { workflowId: string } }>(
    '/api/workflows/definitions/:workflowId',
    async (request: FastifyRequest<{ Params: { workflowId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { workflowId } = request.params;
      const definition = workflowDefinitionStore.getDefinitionById(workflowId);

      if (!definition) {
        const error = ApiErrorFactory.notFound('Workflow definition not found');
        return reply.code(404).send(error);
      }

      if (definition.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Workflow definition not found');
        return reply.code(404).send(error);
      }

      return reply.code(200).send({ data: mapDefinitionToResponse(definition) });
    }
  );

  // POST /api/workflows/runs - Start a new workflow run
  server.post<{ Body: StartRunRequest & { definitionId: string } }>(
    '/api/workflows/runs',
    async (request: FastifyRequest<{ Body: StartRunRequest & { definitionId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { definitionId, inputData } = request.body || {};

      if (!definitionId || typeof definitionId !== 'string') {
        const error = ApiErrorFactory.badRequest('definitionId is required');
        return reply.code(400).send(error);
      }

      const definition = workflowDefinitionStore.getDefinitionById(definitionId);

      if (!definition) {
        const error = ApiErrorFactory.notFound('Workflow definition not found');
        return reply.code(404).send(error);
      }

      if (definition.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Workflow definition not found');
        return reply.code(404).send(error);
      }

      try {
        const result = workflowRuntime.startWorkflowRun({
          definitionId,
          inputData,
          userId,
        });

        // Get the full run with step runs
        const run = workflowRunStore.getWorkflowRunById(result.workflowRunId);
        const stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId);

        if (!run) {
          const error = ApiErrorFactory.internalError('Failed to retrieve created run');
          return reply.code(500).send(error);
        }

        return reply.code(201).send({ data: mapRunToResponse(run, stepRuns) });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to start workflow run';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // GET /api/workflows/runs/:workflowRunId - Get a specific run
  server.get<{ Params: { workflowRunId: string } }>(
    '/api/workflows/runs/:workflowRunId',
    async (request: FastifyRequest<{ Params: { workflowRunId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { workflowRunId } = request.params;
      const run = workflowRunStore.getWorkflowRunById(workflowRunId);

      if (!run) {
        const error = ApiErrorFactory.notFound('Workflow run not found');
        return reply.code(404).send(error);
      }

      if (run.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Workflow run not found');
        return reply.code(404).send(error);
      }

      const stepRuns = workflowRunStore.getStepsByWorkflowRunId(workflowRunId);

      return reply.code(200).send({ data: mapRunToResponse(run, stepRuns) });
    }
  );

  // GET /api/workflows/runs - List runs for current user
  server.get(
    '/api/workflows/runs',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      // Get all definitions for this user, then get runs for each
      const definitions = workflowDefinitionStore.getDefinitionsByOwner(userId);
      const allRuns: Array<{ run: WorkflowRun; stepRuns: WorkflowStepRun[] }> = [];

      for (const def of definitions) {
        const runs = workflowRunStore.getWorkflowRunsByWorkflow(def.workflowId);
        for (const run of runs) {
          const stepRuns = workflowRunStore.getStepsByWorkflowRunId(run.workflowRunId);
          allRuns.push({ run, stepRuns });
        }
      }

      // Sort by startedAt descending
      allRuns.sort((a, b) => {
        const aTime = a.run.startedAt ? new Date(a.run.startedAt).getTime() : 0;
        const bTime = b.run.startedAt ? new Date(b.run.startedAt).getTime() : 0;
        return bTime - aTime;
      });

      const response = allRuns.map(({ run, stepRuns }) => mapRunToResponse(run, stepRuns));

      return reply.code(200).send({ data: response });
    }
  );
}
