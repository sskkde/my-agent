import { beforeEach, describe, expect, it } from "vitest";
import {
	ALL_BUILTIN_SKILL_DEFINITIONS,
	BUILTIN_ACTIVE_SKILL_DEFINITIONS,
	DEPRECATED_SKILL_ALIASES,
	isDeprecatedAlias,
	registerBuiltinSkills,
} from "../../../src/skills/builtin/manifest.js";
import { createSkillRegistry } from "../../../src/skills/skill-registry.js";
import type { SkillRegistry } from "../../../src/skills/types.js";
import { getFallbackToolCatalog } from "../../../src/tools/tool-catalog.js";

/**
 * Derive known tool IDs from the tool catalog.
 * This replaces hard-coded tool ID lists with catalog-derived data.
 */
function getKnownToolIds(): string[] {
	return getFallbackToolCatalog().map((entry) => entry.name);
}

/**
 * Derive known skill IDs from the skill registry.
 * This replaces hard-coded KNOWN_SKILL_IDS with registry-derived data.
 */
function getKnownSkillIds(registry: SkillRegistry): string[] {
	return registry.list().map((def) => def.skillId);
}

/**
 * Derive active (non-deprecated) skill IDs from the manifest.
 */
function getActiveSkillIds(): string[] {
	return BUILTIN_ACTIVE_SKILL_DEFINITIONS.map((def) => def.skillId);
}

describe("Skill Catalog Consistency", () => {
	let registry: SkillRegistry;

	beforeEach(() => {
		registry = createSkillRegistry();
		registerBuiltinSkills(registry);
	});

	describe("Skill/Tool ID Boundary Guard", () => {
		it("should have no active skill ID that is also a tool ID", () => {
			const toolIds = new Set(getKnownToolIds());
			const activeSkillIds = getActiveSkillIds();

			const conflicts = activeSkillIds.filter((skillId) =>
				toolIds.has(skillId),
			);

			expect(conflicts).toEqual([]);
		});

		it("should have every deprecated alias that overlaps with a tool ID explicitly listed as deprecated", () => {
			const toolIds = new Set(getKnownToolIds());

			for (const [aliasId, _targetId] of DEPRECATED_SKILL_ALIASES) {
				if (toolIds.has(aliasId)) {
					// This alias overlaps with a tool ID — it must be marked deprecated
					expect(isDeprecatedAlias(aliasId)).toBe(true);

					const definition = registry.get(aliasId);
					expect(definition).not.toBeNull();
					expect(definition?.tags).toContain("deprecated");
					expect(definition?.enabled).toBe(false);
				}
			}
		});

		it("should have all deprecated aliases disabled in the registry", () => {
			for (const [aliasId, _targetId] of DEPRECATED_SKILL_ALIASES) {
				const definition = registry.get(aliasId);
				expect(definition).not.toBeNull();
				expect(definition?.enabled).toBe(false);
				expect(definition?.tags).toContain("deprecated");
			}
		});

		it("should have all active skills enabled in the registry", () => {
			const activeSkillIds = getActiveSkillIds();

			for (const skillId of activeSkillIds) {
				const definition = registry.get(skillId);
				expect(definition).not.toBeNull();
				expect(definition?.enabled).toBe(true);
				expect(definition?.tags).not.toContain("deprecated");
			}
		});
	});

	describe("Registry Internal Consistency", () => {
		it("should have all manifest definitions registered", () => {
			for (const def of ALL_BUILTIN_SKILL_DEFINITIONS) {
				expect(registry.has(def.skillId)).toBe(true);
			}
		});

		it("should have no duplicate skill IDs in the manifest", () => {
			const skillIds = ALL_BUILTIN_SKILL_DEFINITIONS.map((def) => def.skillId);
			const uniqueIds = new Set(skillIds);

			expect(skillIds.length).toBe(uniqueIds.size);
		});

		it("should have all registered skills with valid required fields", () => {
			const allSkills = registry.list();

			for (const skill of allSkills) {
				expect(skill.skillId).toBeDefined();
				expect(skill.skillId.length).toBeGreaterThan(0);
				expect(skill.name).toBeDefined();
				expect(skill.name.length).toBeGreaterThan(0);
				expect(skill.description).toBeDefined();
				expect(skill.description.length).toBeGreaterThan(0);
				expect(skill.category).toBeDefined();
				expect(skill.sensitivity).toBeDefined();
				expect(typeof skill.enabled).toBe("boolean");
				expect(skill.source).toBeDefined();
				expect(Array.isArray(skill.allowedAgentTypes)).toBe(true);
				expect(Array.isArray(skill.defaultAgentProfiles)).toBe(true);
				expect(skill.documentPath).toBeDefined();
				expect(skill.documentPath.length).toBeGreaterThan(0);
			}
		});

		it("should have deterministic sorted order", () => {
			const firstList = registry.list().map((s) => s.skillId);
			const secondList = registry.list().map((s) => s.skillId);

			expect(firstList).toEqual(secondList);

			// Verify sorted
			for (let i = 1; i < firstList.length; i++) {
				expect(
					firstList[i - 1].localeCompare(firstList[i]),
				).toBeLessThanOrEqual(0);
			}
		});

		it("should have all deprecated aliases pointing to valid active skills", () => {
			const activeSkillIds = new Set(getActiveSkillIds());

			for (const [aliasId, targetId] of DEPRECATED_SKILL_ALIASES) {
				expect(activeSkillIds.has(targetId)).toBe(true);

				const aliasDef = registry.get(aliasId);
				expect(aliasDef).not.toBeNull();
				expect(aliasDef?.description).toContain(targetId);
			}
		});
	});

	describe("Registry-Derived Helper Functions", () => {
		it("should derive known skill IDs from registry", () => {
			const knownSkillIds = getKnownSkillIds(registry);

			expect(knownSkillIds.length).toBeGreaterThan(0);
			expect(knownSkillIds).toContain("artifact_workflow");
			expect(knownSkillIds).toContain("memory_research");
			expect(knownSkillIds).toContain("session_status");
			expect(knownSkillIds).toContain("documentation_search");
			expect(knownSkillIds).toContain("web_research_guidance");
		});

		it("should derive active skill IDs from manifest", () => {
			const activeSkillIds = getActiveSkillIds();

			expect(activeSkillIds.length).toBe(5);
			expect(activeSkillIds).toContain("artifact_workflow");
			expect(activeSkillIds).toContain("memory_research");
			expect(activeSkillIds).toContain("session_status");
			expect(activeSkillIds).toContain("documentation_search");
			expect(activeSkillIds).toContain("web_research_guidance");
		});

		it("should derive known tool IDs from catalog", () => {
			const toolIds = getKnownToolIds();

			expect(toolIds.length).toBeGreaterThan(0);
			expect(toolIds).toContain("artifact_create");
			expect(toolIds).toContain("web_search");
			expect(toolIds).toContain("file_read");
		});

		it("should include deprecated aliases in registry list", () => {
			const knownSkillIds = getKnownSkillIds(registry);

			// Deprecated aliases should be in the registry
			expect(knownSkillIds).toContain("artifact_create");
			expect(knownSkillIds).toContain("web_search");
			expect(knownSkillIds).toContain("docs_search");

			// But they should be marked as deprecated
			for (const aliasId of DEPRECATED_SKILL_ALIASES.keys()) {
				expect(knownSkillIds).toContain(aliasId);
			}
		});
	});

	describe("Skill/Tool ID Overlap Analysis", () => {
		it("should document which deprecated skill aliases overlap with tool IDs", () => {
			const toolIds = new Set(getKnownToolIds());
			const overlappingAliases: string[] = [];

			for (const [aliasId, _targetId] of DEPRECATED_SKILL_ALIASES) {
				if (toolIds.has(aliasId)) {
					overlappingAliases.push(aliasId);
				}
			}

			// These are the known overlaps — they exist for backward compatibility
			// and must be explicitly listed as deprecated migration aliases
			expect(overlappingAliases.length).toBeGreaterThan(0);
			expect(overlappingAliases).toContain("artifact_create");
			expect(overlappingAliases).toContain("artifact_update");
			expect(overlappingAliases).toContain("ask_user");
			expect(overlappingAliases).toContain("status_query");
			expect(overlappingAliases).toContain("memory_retrieve");
			expect(overlappingAliases).toContain("transcript_search");
			expect(overlappingAliases).toContain("plan_patch");
			expect(overlappingAliases).toContain("docs_search");
			expect(overlappingAliases).toContain("web_search");
		});

		it("should have no active skill IDs that overlap with tool IDs", () => {
			const toolIds = new Set(getKnownToolIds());
			const activeSkillIds = getActiveSkillIds();

			for (const skillId of activeSkillIds) {
				expect(toolIds.has(skillId)).toBe(false);
			}
		});
	});
});
