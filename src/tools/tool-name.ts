/**
 * Tool name validation and sanitization utilities.
 *
 * Official spec: tool names must match [A-Za-z0-9_-]{1,64}.
 * Dynamic patterns like `connector.{id}.{operation}` and `mcp.{server}.{tool}`
 * historically used dots which are illegal under this rule. These utilities ensure
 * generated names are legal while bridges preserve metadata for reverse lookup
 * during dispatch.
 */

const TOOL_NAME_MAX_LENGTH = 64;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Returns true if `name` conforms to the legal [A-Za-z0-9_-]{1,64} rule.
 */
export function isValidToolName(name: string): boolean {
  return TOOL_NAME_PATTERN.test(name);
}

/**
 * Sanitizes an arbitrary string into a legal tool name:
 * 1. Replaces every run of illegal characters with a single `_`.
 * 2. Collapses consecutive underscores.
 * 3. Strips leading / trailing underscores.
 * 4. Truncates to {@link TOOL_NAME_MAX_LENGTH}.
 * 5. Falls back to `"tool"` if the result is empty.
 *
 * This is intentionally lossy — bridges MUST store enough metadata
 * (e.g. `rawToolName`, `serverId`, `connectorId`) to route dispatch
 * back to the original operation.
 */
export function sanitizeToolName(name: string): string {
  const sanitized = name
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, TOOL_NAME_MAX_LENGTH);

  return sanitized || 'tool';
}
