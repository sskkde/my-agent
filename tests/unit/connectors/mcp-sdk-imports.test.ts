/**
 * Compile-tested proof that @modelcontextprotocol/sdk is importable.
 *
 * This file exists to verify the SDK dependency resolves at both
 * runtime and type-check time. The actual transport/client usage
 * will live in the MCP Streamable HTTP transport module (Task 4).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, it, expect } from "vitest";

describe("MCP SDK imports", () => {
  it("Client is a constructable class", () => {
    expect(typeof Client).toBe("function");
  });

  it("StreamableHTTPClientTransport is a constructable class", () => {
    expect(typeof StreamableHTTPClientTransport).toBe("function");
  });
});
