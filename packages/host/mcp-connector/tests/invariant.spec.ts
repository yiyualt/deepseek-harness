/** Package invariant companion ownership. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as McpConnectorInvariant from '../src/invariant.ts'

describe('mcp-connector invariant companion', () => {
  it('registers and releases the package-owned empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(McpConnectorInvariant)
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await expect(ctx.plugin(McpConnectorInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
