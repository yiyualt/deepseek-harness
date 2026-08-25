import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import McpRuntime, {
  mcpServerName,
  type McpCallToolRequest,
  type McpConnectRequest,
  type McpResult,
  type McpRuntimeSnapshot,
  type McpServerName,
  type McpServerSnapshot,
} from '../src/index.ts'

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

  commit(state: McpRuntimeSnapshot): void {
    this.state = state
    this.notifyChange()
  }
}

describe('mcpServerName', () => {
  it('brands stable names within the public-name budget', () => {
    expect(mcpServerName('tencent_docs')).toBe('tencent_docs')
    expect(mcpServerName('A-1')).toBe('A-1')
  })

  it('rejects invalid or overlong names', () => {
    for (const value of ['', 'has space', 'has.dot', 'x'.repeat(33)]) {
      expect(() => mcpServerName(value)).toThrow(TypeError)
    }
  })
})

describe('McpRuntime change notification', () => {
  it('emits the exact committed safe snapshot', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeMcpRuntime)
    const seen: McpRuntimeSnapshot[] = []
    ctx.on('mcp/change', snapshot => void seen.push(snapshot))
    const snapshot: McpRuntimeSnapshot = {
      revision: 1,
      servers: [{
        serverName: mcpServerName('docs'),
        status: 'connected',
        generation: 1,
        tools: [],
      }],
    }

    ;(ctx.mcp as FakeMcpRuntime).commit(snapshot)

    expect(seen).toEqual([snapshot])
    expect(ctx.mcp.snapshot()).toBe(snapshot)
  })

  it('contains ordinary listener failures and still runs later listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeMcpRuntime)
    const later = vi.fn()
    ctx.on('mcp/change', () => { throw new Error('observer failed') })
    ctx.on('mcp/change', later)

    expect(() => {
      ;(ctx.mcp as FakeMcpRuntime).commit({ revision: 1, servers: [] })
    }).not.toThrow()
    expect(later).toHaveBeenCalledOnce()
  })

  it('contains asynchronous listener rejection', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeMcpRuntime)
    const later = vi.fn()
    ctx.on('mcp/change', () => Promise.reject(new Error('async observer failed')))
    ctx.on('mcp/change', later)

    ;(ctx.mcp as FakeMcpRuntime).commit({ revision: 1, servers: [] })
    await Promise.resolve()

    expect(later).toHaveBeenCalledOnce()
  })

  it('runs every listener then rethrows the first synchronous invariant failure', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeMcpRuntime)
    const first = Object.assign(new Error('first invariant'), { code: 'INVARIANT' })
    const second = Object.assign(new Error('second invariant'), { code: 'INVARIANT' })
    const later = vi.fn()
    ctx.on('mcp/change', () => { throw first })
    ctx.on('mcp/change', () => { throw second })
    ctx.on('mcp/change', later)

    expect(() => {
      ;(ctx.mcp as FakeMcpRuntime).commit({ revision: 1, servers: [] })
    }).toThrow(first)
    expect(later).toHaveBeenCalledOnce()
  })

  it('contains non-Error thrown values', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeMcpRuntime)
    ctx.on('mcp/change', () => { throw null })

    expect(() => {
      ;(ctx.mcp as FakeMcpRuntime).commit({ revision: 1, servers: [] })
    }).not.toThrow()
  })
})
