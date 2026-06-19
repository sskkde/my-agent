# Todo 16 Evidence: Agent Type/Profile Split Migration

## Date: 2026-06-19

## Summary
Added migration v63 to split `agent_type` into closed `AgentType` + `agent_profile` label across three tables: `subagent_runs`, `background_runs`, and `subagent_provider_preferences`.

## Files Modified
- `src/storage/all-stores-migrations.ts` — added `agentTypeProfileSplitMigration` (v63)
- `src/storage/subagent-run-store.ts` — added `agentProfile` field to record, row, query interfaces; updated create/query methods
- `src/storage/background-run-store.ts` — added `agentProfile` field to record interface; updated create/mapRow methods
- `src/storage/subagent-provider-preference-store.ts` — changed API from `agentType` key to `agentProfile` key; updated all methods
- `migrations/021_agent_type_profile_split.sql` — SQL migration file

## Files Created
- `tests/unit/storage/agent-type-profile-migration.test.ts` — 6 test cases

## Migration Behavior
- `subagent_runs`: old `agent_type` → `agent_profile`, `agent_type` → `'subagent'`
- `background_runs`: old `agent_type` → `agent_profile`, `agent_type` → `'background'`
- `subagent_provider_preferences`: old `agent_type` → `agent_profile`, `agent_type` → `'subagent'`
- Indexes created on `agent_profile` for all three tables

## Verification
```
$ rm -f /tmp/neon-star-agent-taxonomy-migration.sqlite && DATABASE_PATH=/tmp/neon-star-agent-taxonomy-migration.sqlite npm run db:migrate
Current database version: 0
Migrated to version: 63
Applied 63 migration(s).

$ npm test -- --run tests/unit/storage/agent-type-profile-migration.test.ts
 ✓ 6 tests passed
```
