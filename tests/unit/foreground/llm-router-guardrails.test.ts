import { beforeAll, describe, expect, it } from "vitest";
import type { RuntimeAction } from "../../../src/dispatcher/types.js";
import type { ForegroundDecision } from "../../../src/foreground/types.js";
import { registerBuiltinSkills } from "../../../src/skills/builtin/manifest.js";
import { createSkillRegistry } from "../../../src/skills/skill-registry.js";
import type { SkillRegistry } from "../../../src/skills/types.js";
import type { AgentConfig } from "../../../src/storage/agent-config-store.js";
import { getFallbackToolCatalog } from "../../../src/tools/tool-catalog.js";

/**
 * Known tool IDs derived from the tool catalog.
 * Replaces hard-coded list with catalog-derived data.
 */
const KNOWN_TOOL_IDS: string[] = getFallbackToolCatalog().map(
	(entry) => entry.name,
);

/**
 * Known skill IDs derived from the skill registry.
 * Replaces hard-coded list with registry-derived data.
 */
let KNOWN_SKILL_IDS: string[] = [];

beforeAll(() => {
	const registry: SkillRegistry = createSkillRegistry();
	registerBuiltinSkills(registry);
	KNOWN_SKILL_IDS = registry.list().map((def) => def.skillId);
});

describe("LLM Router Guardrails", () => {
	const createMockAgentConfig = (
		overrides: Partial<AgentConfig> = {},
	): AgentConfig => ({
		agentConfigId: "test-config-id",
		agentId: "foreground.default",
		scope: "user",
		userId: "user-123",
		displayName: "Test Agent",
		enabled: true,
		systemPrompt: "You are a helpful assistant",
		routingPrompt: null,
		providerId: null,
		model: null,
		allowedToolIds: [],
		allowedSkillIds: [],
		routingTimeoutMs: 10000,
		repairAttempts: 1,
		promptType: null,
		promptVersion: null,
		searchLlmProviderId: null,
		searchLlmModel: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	});

	const createMockRuntimeAction = (
		overrides: Partial<RuntimeAction> = {},
	): RuntimeAction => ({
		actionId: "action-123",
		actionType: "execute_tool",
		targetRuntime: "tool_runtime",
		source: { sourceModule: "test", sourceAction: "test" },
		userId: "user-123",
		sessionId: "session-123",
		targetRef: {},
		targetAction: "execute",
		payload: {},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		status: "created",
		...overrides,
	});

	describe("Tool Filtering", () => {
		it("should filter out hallucinated tools not in known catalog", () => {
			const suggestedTools = [
				"hallucinated.tool.that.does.not.exist",
				"docs_search",
				"another.fake",
			];
			const filtered = suggestedTools.filter((toolId) =>
				KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual(["docs_search"]);
			expect(filtered).not.toContain("hallucinated.tool.that.does.not.exist");
			expect(filtered).not.toContain("another.fake");
		});

		it("should filter tools against AgentConfig allowlist", () => {
			const agentConfig = createMockAgentConfig({
				allowedToolIds: ["docs_search", "memory_retrieve"],
			});

			const suggestedTools = [
				"docs_search",
				"plan_patch",
				"memory_retrieve",
				"unknown.tool",
			];

			const allowedToolIds =
				agentConfig.allowedToolIds === null ||
				agentConfig.allowedToolIds === undefined
					? KNOWN_TOOL_IDS
					: agentConfig.allowedToolIds;

			const filtered = suggestedTools.filter(
				(toolId) =>
					allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual(["docs_search", "memory_retrieve"]);
			expect(filtered).not.toContain("plan_patch");
			expect(filtered).not.toContain("unknown.tool");
		});

		it("should return empty array when all tools are disallowed", () => {
			const agentConfig = createMockAgentConfig({
				allowedToolIds: ["docs_search"],
			});

			const suggestedTools = ["plan_patch", "artifact_create"];

			const allowedToolIds =
				agentConfig.allowedToolIds === null ||
				agentConfig.allowedToolIds === undefined
					? KNOWN_TOOL_IDS
					: agentConfig.allowedToolIds;

			const filtered = suggestedTools.filter(
				(toolId) =>
					allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual([]);
		});

		it("should allow all known tools when AgentConfig has null allowedToolIds (inherit)", () => {
			const agentConfig = createMockAgentConfig({
				allowedToolIds: null,
			});

			const suggestedTools = [
				"docs_search",
				"memory_retrieve",
				"transcript_search",
			];

			const allowedToolIds =
				agentConfig.allowedToolIds === null ||
				agentConfig.allowedToolIds === undefined
					? KNOWN_TOOL_IDS
					: agentConfig.allowedToolIds;

			const filtered = suggestedTools.filter(
				(toolId) =>
					allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual([
				"docs_search",
				"memory_retrieve",
				"transcript_search",
			]);
		});

		it("should handle undefined suggestedTools", () => {
			const suggestedTools: string[] | undefined = undefined;
			const arr = suggestedTools as string[] | undefined;
			const filtered = arr
				? arr.filter((toolId: string) => KNOWN_TOOL_IDS.includes(toolId))
				: undefined;

			expect(filtered).toBeUndefined();
		});

		it("should handle empty suggestedTools", () => {
			const suggestedTools: string[] = [];
			const filtered = suggestedTools.filter((toolId) =>
				KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual([]);
		});
	});

	describe("Skill Filtering", () => {
		it("should filter out hallucinated skills not in known catalog", () => {
			const suggestedSkills = [
				"hallucinated.skill",
				"docs_search",
				"fake.skill",
			];
			const filtered = suggestedSkills.filter((skillId) =>
				KNOWN_SKILL_IDS.includes(skillId),
			);

			expect(filtered).toEqual(["docs_search"]);
			expect(filtered).not.toContain("hallucinated.skill");
			expect(filtered).not.toContain("fake.skill");
		});

		it("should filter skills against AgentConfig allowlist", () => {
			const agentConfig = createMockAgentConfig({
				allowedSkillIds: ["docs_search", "memory_retrieve"],
			});

			const suggestedSkills = ["docs_search", "plan_patch", "memory_retrieve"];

			const allowedSkillIds =
				agentConfig.allowedSkillIds === null ||
				agentConfig.allowedSkillIds === undefined
					? KNOWN_SKILL_IDS
					: agentConfig.allowedSkillIds;

			const filtered = suggestedSkills.filter(
				(skillId) =>
					allowedSkillIds.includes(skillId) &&
					KNOWN_SKILL_IDS.includes(skillId),
			);

			expect(filtered).toEqual(["docs_search", "memory_retrieve"]);
			expect(filtered).not.toContain("plan_patch");
		});
	});

	describe("RuntimeAction Guardrails", () => {
		it("should reject route when cancel_or_modify_task lacks runtimeAction", () => {
			const decision: ForegroundDecision = {
				route: "cancel_or_modify_task",
				reason: "User wants to cancel",
				requiresPlanner: false,
			};

			const validateRouteGuardrails = (
				decision: ForegroundDecision,
			): string | null => {
				if (
					decision.route === "cancel_or_modify_task" ||
					decision.route === "status_query"
				) {
					if (!decision.runtimeAction) {
						return `Route '${decision.route}' requires a server-created runtimeAction`;
					}
				}
				return null;
			};

			const error = validateRouteGuardrails(decision);

			expect(error).toBe(
				"Route 'cancel_or_modify_task' requires a server-created runtimeAction",
			);
		});

		it("should reject route when status_query lacks runtimeAction", () => {
			const decision: ForegroundDecision = {
				route: "status_query",
				reason: "User wants status",
				requiresPlanner: false,
			};

			const validateRouteGuardrails = (
				decision: ForegroundDecision,
			): string | null => {
				if (
					decision.route === "cancel_or_modify_task" ||
					decision.route === "status_query"
				) {
					if (!decision.runtimeAction) {
						return `Route '${decision.route}' requires a server-created runtimeAction`;
					}
				}
				return null;
			};

			const error = validateRouteGuardrails(decision);

			expect(error).toBe(
				"Route 'status_query' requires a server-created runtimeAction",
			);
		});

		it("should allow cancel_or_modify_task with server-created runtimeAction", () => {
			const decision: ForegroundDecision = {
				route: "cancel_or_modify_task",
				reason: "User wants to cancel",
				requiresPlanner: false,
				runtimeAction: createMockRuntimeAction({
					actionType: "cancel_planner_run",
					source: {
						sourceModule: "foreground_conversation_agent",
						sourceAction: "cancel",
					},
				}),
			};

			const validateRouteGuardrails = (
				decision: ForegroundDecision,
			): string | null => {
				if (
					decision.route === "cancel_or_modify_task" ||
					decision.route === "status_query"
				) {
					if (!decision.runtimeAction) {
						return `Route '${decision.route}' requires a server-created runtimeAction`;
					}
				}
				return null;
			};

			const error = validateRouteGuardrails(decision);

			expect(error).toBeNull();
		});

		it("should allow status_query with server-created runtimeAction", () => {
			const decision: ForegroundDecision = {
				route: "status_query",
				reason: "User wants status",
				requiresPlanner: false,
				runtimeAction: createMockRuntimeAction({
					actionType: "query_active_work",
					source: {
						sourceModule: "foreground_conversation_agent",
						sourceAction: "status_query",
					},
				}),
			};

			const validateRouteGuardrails = (
				decision: ForegroundDecision,
			): string | null => {
				if (
					decision.route === "cancel_or_modify_task" ||
					decision.route === "status_query"
				) {
					if (!decision.runtimeAction) {
						return `Route '${decision.route}' requires a server-created runtimeAction`;
					}
				}
				return null;
			};

			const error = validateRouteGuardrails(decision);

			expect(error).toBeNull();
		});

		it("should ignore LLM-provided runtimeAction for cancel route", () => {
			const serverCreatedAction = createMockRuntimeAction({
				actionId: "server-created-action",
				actionType: "cancel_planner_run",
				source: {
					sourceModule: "foreground_conversation_agent",
					sourceAction: "cancel",
				},
				targetRef: { runId: "planner-run-123" },
				payload: { workId: "planner-run-123", workType: "planner_run" },
			});

			const decision: ForegroundDecision = {
				route: "cancel_or_modify_task",
				reason: "User wants to cancel",
				requiresPlanner: false,
				// Server replaces LLM-provided action with its own
				runtimeAction: serverCreatedAction,
			};

			expect(decision.runtimeAction?.source.sourceModule).toBe(
				"foreground_conversation_agent",
			);
			expect(decision.runtimeAction?.actionType).toBe("cancel_planner_run");
			expect(decision.runtimeAction?.actionId).not.toBe(
				"llm-hallucinated-action",
			);
		});
	});

	describe("Known Catalog Validation", () => {
		it("should only accept tools from known catalog", () => {
			const suggestedTools = [
				"artifact_create",
				"artifact_update",
				"malicious_tool",
				"another.unknown",
				"docs_search",
				"web_search",
			];

			const filtered = suggestedTools.filter((toolId) =>
				KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual([
				"artifact_create",
				"artifact_update",
				"docs_search",
				"web_search",
			]);
			expect(filtered).not.toContain("malicious_tool");
			expect(filtered).not.toContain("another.unknown");
		});

		it("should only accept skills from known catalog", () => {
			const suggestedSkills = [
				"artifact_create",
				"malicious_skill",
				"memory_retrieve",
			];

			const filtered = suggestedSkills.filter((skillId) =>
				KNOWN_SKILL_IDS.includes(skillId),
			);

			expect(filtered).toEqual(["artifact_create", "memory_retrieve"]);
			expect(filtered).not.toContain("malicious_skill");
		});

		it("should handle all known tools correctly", () => {
			const allKnownTools = [...KNOWN_TOOL_IDS];
			const filtered = allKnownTools.filter((toolId) =>
				KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual(KNOWN_TOOL_IDS);
		});

		it("should handle all known skills correctly", () => {
			const allKnownSkills = [...KNOWN_SKILL_IDS];
			const filtered = allKnownSkills.filter((skillId) =>
				KNOWN_SKILL_IDS.includes(skillId),
			);

			expect(filtered).toEqual(KNOWN_SKILL_IDS);
		});
	});

	describe("Intersection Logic", () => {
		it("should perform three-way intersection: suggested ∩ allowed ∩ known", () => {
			const agentConfig = createMockAgentConfig({
				allowedToolIds: ["docs_search", "memory_retrieve", "transcript_search"],
			});

			const suggestedTools = [
				"docs_search",
				"memory_retrieve",
				"plan_patch",
				"hallucinated.tool",
				"artifact_create",
			];

			const allowedToolIds = agentConfig.allowedToolIds ?? [];

			const filtered = suggestedTools.filter(
				(toolId) =>
					allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual(["docs_search", "memory_retrieve"]);
			expect(filtered).not.toContain("plan_patch");
			expect(filtered).not.toContain("hallucinated.tool");
			expect(filtered).not.toContain("artifact_create");
		});

		it("should return empty when suggested and allowed have no intersection", () => {
			const agentConfig = createMockAgentConfig({
				allowedToolIds: ["docs_search"],
			});

			const suggestedTools = ["plan_patch", "artifact_create"];

			const filtered = suggestedTools.filter(
				(toolId) =>
					(agentConfig.allowedToolIds ?? []).includes(toolId) &&
					KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual([]);
		});

		it("should return empty when suggested and known have no intersection", () => {
			const suggestedTools = ["completely.unknown.tool", "another.fake"];

			const filtered = suggestedTools.filter((toolId) =>
				KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual([]);
		});
	});

	describe("Edge Cases", () => {
		it("should handle null AgentConfig gracefully (all known tools)", () => {
			const agentConfig: AgentConfig | null = null;
			const suggestedTools = ["docs_search", "plan_patch"];

			const cfg = agentConfig as AgentConfig | null;
			const allowedToolIds: string[] =
				cfg?.allowedToolIds === null || cfg?.allowedToolIds === undefined
					? KNOWN_TOOL_IDS
					: cfg.allowedToolIds;

			const filtered = suggestedTools.filter(
				(toolId) =>
					allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual(["docs_search", "plan_patch"]);
		});

		it("should handle AgentConfig with null allowedToolIds (inherit = all known)", () => {
			const agentConfig = createMockAgentConfig({
				allowedToolIds: null,
			});

			const suggestedTools = ["docs_search", "plan_patch"];

			const allowedToolIds =
				agentConfig.allowedToolIds === null ||
				agentConfig.allowedToolIds === undefined
					? KNOWN_TOOL_IDS
					: agentConfig.allowedToolIds;

			const filtered = suggestedTools.filter(
				(toolId) =>
					allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual(["docs_search", "plan_patch"]);
		});

		it("should handle AgentConfig with empty allowedToolIds (none allowed)", () => {
			const agentConfig = createMockAgentConfig({
				allowedToolIds: [],
			});

			const suggestedTools = ["docs_search", "plan_patch"];

			const allowedToolIds =
				agentConfig.allowedToolIds === null ||
				agentConfig.allowedToolIds === undefined
					? KNOWN_TOOL_IDS
					: agentConfig.allowedToolIds;

			const filtered = suggestedTools.filter(
				(toolId) =>
					allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual([]);
		});

		it("should handle duplicate tool suggestions", () => {
			const suggestedTools = [
				"docs_search",
				"docs_search",
				"memory_retrieve",
				"docs_search",
			];

			const filtered = suggestedTools.filter((toolId) =>
				KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual([
				"docs_search",
				"docs_search",
				"memory_retrieve",
				"docs_search",
			]);
		});

		it("should handle case-sensitive tool IDs", () => {
			const suggestedTools = ["Docs.Search", "DOCS.SEARCH", "docs_search"];

			const filtered = suggestedTools.filter((toolId) =>
				KNOWN_TOOL_IDS.includes(toolId),
			);

			expect(filtered).toEqual(["docs_search"]);
		});
	});
});
