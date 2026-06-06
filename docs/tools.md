# Runtime Tools Documentation

This document describes the runtime command-execution tools added to the Agent Platform: `exec`, `bash`, `process`, and `code_execution`.

## ⚠️ CRITICAL SECURITY NOTICE

**These tools do NOT provide a sandbox.** They execute commands in the same environment as the agent with controlled execution, approval requirements, timeouts, and output caps. Use with caution.

## Tools Overview

| Tool | Category | Sensitivity | Requires Permission | Description |
|------|----------|-------------|---------------------|-------------|
| `exec` | execute | high | Yes | Execute shell commands with validation and timeout |
| `bash` | execute | high | Yes | Alias for exec tool |
| `process` | execute | high | Yes | Manage background process sessions |
| `code_execution` | execute | high | Yes | Execute code in JS/TS/Bash |

## exec Tool

Execute a shell command with security validation, timeout, and output management.

**Parameters:**
```json
{
  "command": "string (required)",
  "workdir": "string (optional, must be within workspace)",
  "env": "object (optional, all values must be strings)",
  "timeoutMs": "number (default: 30000, max: 600000)",
  "yieldMs": "number (default: 10000)",
  "background": "boolean (default: false)",
  "maxOutputChars": "number (default: 64000)"
}
```

**Example:**
```json
{
  "command": "node -e \"console.log('Hello')\"",
  "timeoutMs": 5000
}
```

## bash Tool

Alias for the `exec` tool with identical functionality and parameters.

## process Tool

Manage background process sessions with these actions:

- **list**: List all sessions for the current user
- **poll**: Get detailed status of a specific session
- **kill**: Terminate a running session
- **clear**: Remove a completed session

**Example - Poll Session:**
```json
{
  "action": "poll",
  "sessionId": "proc_abc123"
}
```

## code_execution Tool

Execute code in JavaScript, TypeScript, or Bash.

**Parameters:**
```json
{
  "language": "javascript | typescript | bash",
  "code": "string (required)",
  "timeoutMs": "number (optional)",
  "workdir": "string (optional)",
  "maxOutputChars": "number (optional)"
}
```

**Example:**
```json
{
  "language": "javascript",
  "code": "console.log(1 + 1);"
}
```

**Language Availability:**
- **JavaScript**: Always available
- **TypeScript**: Requires `tsx` package
- **Bash**: Requires `bash` in PATH

## Security Boundaries

### Hard Limits

- **Timeout**: Maximum 10 minutes (600,000 ms)
- **Output**: Maximum 64 KiB per stream
- **Workdir**: Must be within workspace root
- **Environment**: All env keys and values must be strings

### Dangerous Command Denylist

These patterns are **always rejected**:

- `rm -rf /<path>` - Recursive force delete from root
- `mkfs` - Filesystem formatting
- `shutdown`, `reboot`, `halt`, `poweroff` - System power control
- Fork bombs
- `curl ... | sh`, `wget ... | sh` - Download and execute
- `dd ... of=/dev/sd*` - Block device writes

### Permission Requirements

All runtime tools require approval before execution due to their high sensitivity and execute category.

## Known Limitations

1. **No sandbox**: Commands run in the same environment as the agent
2. **Combined output**: stdout and stderr are combined into a single output field
3. **No streaming**: Output is buffered and returned on completion
4. **No PTY support**: Interactive TUI applications not supported
5. **Workspace-bound**: All operations must be within workspace directory

## Testing

```bash
# Run runtime tool tests
npx vitest run tests/unit/tools/exec-tool.test.ts
npx vitest run tests/unit/tools/process-session-store.test.ts

# Run type checking
npm run typecheck
```
