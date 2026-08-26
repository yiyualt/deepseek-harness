/** Package invariant companion ownership. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as KingsoftDocsConnectorInvariant from '../src/invariant.ts'

describe('kingsoft-docs-connector invariant companion', () => {
  it('registers and releases the package-owned empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(KingsoftDocsConnectorInvariant)
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await expect(ctx.plugin(KingsoftDocsConnectorInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
