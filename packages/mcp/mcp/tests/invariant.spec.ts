import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import McpRuntime, {
  type McpCallToolRequest,
  type McpConnectRequest,
  type McpResult,
  type McpRuntimeSnapshot,
  type McpServerName,
  type McpServerSnapshot,
} from '../src/index.ts'
import * as McpInvariant from '../src/invariant.ts'

class FakeMcpRuntime extends McpRuntime {
  private state: McpRuntimeSnapshot = { revision: 0, servers: [] }

  override connect(_request: McpConnectRequest): Promise<McpServerSnapshot> {
    return Promise.reject(new Error('not implemented by fake'))
  }

  override disconnect(_serverName: McpServerName): Promise<void> {
    return Promise.resolve()
  }

  override snapshot(): McpRuntimeSnapshot {
    return this.state
  }

  override callTool(_request: McpCallToolRequest): Promise<McpResult> {
    return Promise.resolve({ content: [] })
  }

  commit(snapshot: McpRuntimeSnapshot): void {
    this.state = snapshot
    this.notifyChange()
  }
}

describe('MCP invariant companion', () => {
  it('accepts a snapshot emitted after the service commits it', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(McpInvariant)
    await ctx.plugin(FakeMcpRuntime)

    expect(() => {
      ;(ctx.mcp as FakeMcpRuntime).commit({ revision: 1, servers: [] })
    }).not.toThrow()
  })

  it('rejects a revision that disagrees with the live service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(McpInvariant)
    await ctx.plugin(FakeMcpRuntime)

    expect(() => {
      ctx.emit('mcp/change', { revision: 2, servers: [] })
    }).toThrow(/invariant violated by "@deepseek-ai\/dsh-mcp"/)
  })

  it('rejects an event emitted without a live service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(McpInvariant)

    expect(() => {
      ctx.emit('mcp/change', { revision: 1, servers: [] })
    }).toThrow(/without a live MCP service/)
  })
})
