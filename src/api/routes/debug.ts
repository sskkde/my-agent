import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import { ApiErrorFactory } from '../errors.js';

interface ReplayParams {
  sessionId: string;
}

interface ReplayResponse {
  eventCount: number;
  transcriptCount: number;
  runRefs: string[];
  approvalRefs: string[];
  lastEventId: string | null;
}

export function registerDebugRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get<{
    Params: ReplayParams;
    Reply: ReplayResponse;
  }>('/api/debug/replay/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;

    const events = context.stores.eventStore.query({ sessionId });
    const transcripts = context.stores.transcriptStore.findBySession(sessionId);

    if (events.length === 0 && transcripts.length === 0) {
      const error = ApiErrorFactory.notFound('Session not found');
      return reply.code(404).send(error as unknown as ReplayResponse);
    }

    const eventCount = events.length;
    const transcriptCount = transcripts.length;

    const runRefs = new Set<string>();
    const approvalRefs = new Set<string>();

    for (const event of events) {
      if (event.relatedRefs?.runId) {
        runRefs.add(event.relatedRefs.runId);
      }
      if (event.relatedRefs?.plannerRunId) {
        runRefs.add(event.relatedRefs.plannerRunId);
      }
      if (event.relatedRefs?.backgroundRunId) {
        runRefs.add(event.relatedRefs.backgroundRunId);
      }
      if (event.relatedRefs?.subagentRunId) {
        runRefs.add(event.relatedRefs.subagentRunId);
      }
      if (event.relatedRefs?.workflowRunId) {
        runRefs.add(event.relatedRefs.workflowRunId);
      }
      if (event.relatedRefs?.approvalId) {
        approvalRefs.add(event.relatedRefs.approvalId);
      }
    }

    for (const transcript of transcripts) {
      if (transcript.runtimeSummary?.plannerRunIds) {
        for (const runId of transcript.runtimeSummary.plannerRunIds) {
          runRefs.add(runId);
        }
      }
    }

    const lastEvent = events.length > 0
      ? events[events.length - 1]
      : null;

    const response: ReplayResponse = {
      eventCount,
      transcriptCount,
      runRefs: Array.from(runRefs),
      approvalRefs: Array.from(approvalRefs),
      lastEventId: lastEvent?.eventId ?? null,
    };

    return reply.code(200).send({ data: response } as unknown as ReplayResponse);
  });
}
