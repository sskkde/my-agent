import type {
  SkillDefinition,
  SkillRegistry,
  SkillRegistrationOptions,
  SkillCategory,
  SkillSource,
} from './types.js'
import { isValidSkillId } from './skill-name.js'

class SkillRegistryImpl implements SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map()

  register(definition: SkillDefinition, options: SkillRegistrationOptions = {}): void {
    if (!isValidSkillId(definition.skillId)) {
      throw new Error(
        `Invalid skill ID: "${definition.skillId}". Skill IDs must match [A-Za-z0-9_-]{1,64}.`,
      )
    }

    if (this.skills.has(definition.skillId) && !options.overwriteExisting) {
      throw new Error(`Skill already registered: ${definition.skillId}`)
    }

    this.skills.set(definition.skillId, definition)
  }

  get(skillId: string): SkillDefinition | null {
    return this.skills.get(skillId) ?? null
  }

  has(skillId: string): boolean {
    return this.skills.has(skillId)
  }

  list(): SkillDefinition[] {
    return Array.from(this.skills.values()).sort((a, b) =>
      a.skillId.localeCompare(b.skillId),
    )
  }

  listByCategory(category: SkillCategory): SkillDefinition[] {
    return this.list().filter((skill) => skill.category === category)
  }

  listBySource(source: SkillSource): SkillDefinition[] {
    return this.list().filter((skill) => skill.source === source)
  }

  unregister(skillId: string): boolean {
    return this.skills.delete(skillId)
  }
}

export function createSkillRegistry(): SkillRegistry {
  return new SkillRegistryImpl()
}

export type { SkillRegistry } from './types.js'