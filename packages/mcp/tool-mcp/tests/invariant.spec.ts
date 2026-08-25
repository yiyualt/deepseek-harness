import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ToolMcpInvariant from '../src/invariant.ts'

describe('tool-mcp invariant companion', () => {
  it('reserves the package name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(ToolMcpInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-tool-mcp', () => {})
    }).toThrow(/already registered/)
  })
})
