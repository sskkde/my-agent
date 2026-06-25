# Skills System

> **Key concept:** Skills are **documentation-only records** — metadata plus lazily-loaded markdown instructions. Skills do NOT execute code, make API calls, or perform any side effects. Tools remain the only execution surface.

## Overview

The skill system provides a way to inject documentation, guidance, and context into the LLM's prompt without creating executable capabilities. Skills are:

- **Documentation-only**: Skills contain metadata and markdown instructions, not executable code
- **Lazy-loaded**: Catalog endpoints return metadata only; full documents load on demand
- **Agent-type scoped**: Each agent type has its own skill envelope
- **Permission-controlled**: Skills are subject to allowlist semantics similar to tools

## Skills vs Tools

| Aspect | Skills | Tools |
|--------|--------|-------|
| **Purpose** | Documentation and guidance for the LLM | Executable actions with side effects |
| **Execution** | None — skills are prompt-visible text only | Tools execute code, API calls, file operations |
| **API surface** | `GET /api/v1/skills` (read-only catalog) | `GET /api/v1/tools` + runtime execution |
| **Run endpoint** | None — no `/skills/:id/run` | Tools are invoked during agent runs |
| **Permission model** | `allowedSkillIds` + agent-type envelope | `allowedToolIds` + approval policies |
| **Model input** | Rendered as documentation text in prompt section | Rendered as function-call schemas |

## API Endpoints

### List Skills

```bash
GET /api/v1/skills
```

Returns the read-only skill catalog from the registry. This endpoint returns metadata only — no full document content.

**Response:**
```json
{
  "ok": true,
  "data": {
    "skills": [
      {
        "skillId": "artifact_workflow",
        "name": "Artifact Workflow",
        "description": "Guidance for creating and managing artifacts",
        "category": "automation",
        "sensitivity": "low",
        "enabled": true,
        "source": "builtin"
      }
    ],
    "total": 1
  }
}
```

### Get Skill Detail

```bash
GET /api/v1/skills/:skillId
```

Returns read-only detail for a single skill, including full documentation.

**Response:**
```json
{
  "ok": true,
  "data": {
    "skillId": "artifact_workflow",
    "name": "Artifact Workflow",
    "description": "Guidance for creating and managing artifacts",
    "category": "automation",
    "sensitivity": "low",
    "enabled": true,
    "source": "builtin",
    "allowedAgentTypes": ["main", "subagent", "background"],
    "defaultAgentProfiles": ["default"],
    "summary": "Provides guidance on artifact creation workflows",
    "tags": ["artifacts", "workflow"]
  }
}
```

### No Run Endpoint

There is **no** `/api/v1/skills/:skillId/run` endpoint. Skills are documentation-only and cannot be executed.

## Skill Sources

| Source | Description |
|--------|-------------|
| `builtin` | Built-in skills shipped with the platform |
| `user` | User-created skills |
| `plugin` | Skills from plugins |
| `remote` | Skills from remote registries |

## Skill Categories

| Category | Description |
|----------|-------------|
| `read` | Read-only guidance |
| `write` | Write operation guidance |
| `search` | Search and retrieval guidance |
| `automation` | Workflow and automation guidance |
| `admin` | Administrative guidance |
| `internal` | Internal platform guidance |
| `custom` | Custom user-defined guidance |

## Skill Sensitivity Levels

| Level | Description |
|-------|-------------|
| `low` | Safe for all agent types |
| `medium` | Standard sensitivity |
| `high` | Requires careful consideration |
| `restricted` | Limited to specific agent types |

## Agent-Type Skill Envelopes

Each agent type has a built-in skill envelope that defines which skills are available by default:

| Agent Type | Default Skills | Notes |
|------------|----------------|-------|
| `main` | Safe guidance skills | Primary user-facing agent |
| `subagent` | Profile-relevant guidance | Task-specific subagent |
| `background` | Read-only/status/research guidance | Background processing |
| `workflow_step` | Workflow-step guidance | Workflow execution |
| `remote` | None | Hard-denies all skills |

The `remote` agent type hard-denies all skills as a security measure — remote agents should not receive documentation that could influence their behavior.

## Skill Allowlist Semantics

The `allowedSkillIds` field in agent configuration controls which skills are visible to an agent:

| Value | Behavior |
|-------|----------|
| `null` (or omitted) | Inherits defaults from the agent profile and agent-type envelope |
| `[]` (empty array) | No skills — the agent receives no skill documentation |
| `["skill-a", "skill-b"]` (explicit list) | Intersects with the agent-type envelope; only skills in both the list and the envelope are projected |

### Configuration Examples

```bash
# Inherit defaults (null or omitted)
PATCH /api/agents/foreground.default/config
{
  "allowedSkillIds": null
}

# No skills
PATCH /api/agents/foreground.default/config
{
  "allowedSkillIds": []
}

# Explicit skill list (intersects with agent-type envelope)
PATCH /api/agents/foreground.default/config
{
  "allowedSkillIds": ["artifact_workflow", "memory_research"]
}
```

## Lazy Loading

Skill documents are lazy-loaded for efficiency:

- **Catalog endpoints** (`GET /api/v1/skills`) return metadata only — no full document content
- **Detail endpoints** (`GET /api/v1/skills/:skillId`) return full documentation
- **Runtime projection** loads documents only for skills that pass the allowlist intersection

This ensures that listing skills does not require reading all markdown files.

## Model Input Integration

Skills are rendered in the model input as documentation text, separate from tool schemas:

```
--- Skill Plane (documentation only) ---

## Available Skills

### artifact_workflow
Guidance for creating and managing artifacts...

### memory_research
Guidance for memory research tasks...

--- Tool Plane (callable tools) ---

## Available Tools

### search
Search for information...
```

This separation ensures that:
- Skills cannot become callable functions
- Skills cannot bypass tool permissions
- Skills remain in their designated prompt section

## Security Properties

Skills have several important security properties:

1. **No execution**: Skills cannot execute code, make API calls, or perform file operations
2. **No run endpoint**: There is no `/skills/:id/run` endpoint
3. **Prompt isolation**: Skills are rendered in a separate prompt section from tools
4. **Envelope enforcement**: Agent-type envelopes prevent skills from being loaded for unauthorized agent types
5. **No tool projection**: Skills cannot be rendered as function-call schemas

## Built-in Skills

The platform ships with several built-in skills:

| Skill ID | Description | Category | Sensitivity |
|----------|-------------|----------|-------------|
| `artifact_workflow` | Guidance for artifact creation workflows | automation | low |
| `memory_research` | Guidance for memory research tasks | search | low |
| `session_status` | Guidance for session status queries | read | low |
| `documentation_search` | Guidance for documentation search | search | low |
| `web_research_guidance` | Guidance for web research tasks | search | medium |
| `pptx-generator` | Guidance for generating and reading PowerPoint presentations through the MiniMax Document MCP server | write | medium |
| `minimax-xlsx` | Guidance for reading and validating Excel spreadsheets through the MiniMax Document MCP server | read | medium |
| `minimax-docx` | Guidance for generating Word documents through the MiniMax Document MCP server | write | medium |
| `minimax-pdf` | Guidance for generating PDF documents through the MiniMax Document MCP server | write | medium |

## Creating Custom Skills

Custom skills can be created via the registry API (future feature) or by adding skill definitions to the built-in manifest.

### Skill Definition Structure

```typescript
interface SkillDefinition {
  skillId: string;           // Unique identifier (e.g., "my_custom_skill")
  name: string;              // Human-readable name
  description: string;       // Short description
  category: SkillCategory;   // read, write, search, automation, admin, internal, custom
  sensitivity: SensitivityLevel; // low, medium, high, restricted
  enabled: boolean;          // Whether the skill is active
  source: SkillSource;       // builtin, user, plugin, remote
  allowedAgentTypes: AgentType[]; // Which agent types can use this skill
  defaultAgentProfiles: string[]; // Default profiles that include this skill
  documentPath?: string;     // Path to markdown documentation
  summary?: string;          // Optional summary
  tags?: string[];           // Optional tags
}
```

### Important Constraints

- Skills **cannot** contain handlers, scripts, shell commands, or executable code
- Skills **cannot** be registered as tools
- Skills **cannot** have function-call schemas
- Skills **must** be documentation-only

## Troubleshooting

### Skills not appearing for an agent

1. Check `allowedSkillIds` configuration — `null` inherits defaults, `[]` means no skills
2. Verify the skill is in the agent-type envelope for the agent's type
3. Ensure the skill is enabled (`enabled: true`)
4. Check the skill source is valid (`builtin`, `user`, `plugin`, `remote`)

### Skills appearing but not loading documents

1. Verify the skill has a valid `documentPath`
2. Check the document file exists and is readable
3. Ensure the skill is passing the allowlist intersection

### Skills appearing in wrong agent type

1. Check the skill's `allowedAgentTypes` array
2. Verify the agent-type envelope allows the skill
3. Remember that `remote` agent type hard-denies all skills

## Related Documentation

- [Admin Guide: Skill Configuration](product/admin-guide.md#skill-configuration)
- [Permission Model: Skill Permissions](security/permission-model.md#skill-permissions)
- [API Reference: Skills Endpoints](api/openapi.yaml)
- [README: Skill System](../README.md#skill-system)
