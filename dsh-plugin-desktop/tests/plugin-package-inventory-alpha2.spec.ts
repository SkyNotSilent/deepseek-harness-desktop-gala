import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '@deepseek-ai/dsh-plugin-package-inventory-deepseek'
import { describe, expect, it, vi } from 'vitest'

interface InventoryContribution {
  prepare(request: { sessionId?: string }): Promise<{
    value: {
      version: number
      packages: Array<{ name: string, version: string }>
    }
  }>
}

function activeEntry(tree: object, name: string, options: { disabled?: boolean, group?: boolean } = {}) {
  return {
    options: { name, group: options.group ?? false },
    disabled: options.disabled ?? false,
    fiber: { state: 2 },
    parent: { tree },
  }
}

describe('alpha.2 DeepSeek plugin package inventory', () => {
  it('contributes only active package names and versions to the actual request extension', async () => {
    let contribution: InventoryContribution | undefined
    const tree = {
      ctx: { baseUrl: import.meta.url },
      entries: vi.fn<() => Iterable<ReturnType<typeof activeEntry>>>(),
    }
    tree.entries.mockImplementation(() => [
      activeEntry(tree, fileURLToPath(new URL('../src/index.ts', import.meta.url))),
      activeEntry(tree, 'dsh-plugin-gala'),
      activeEntry(tree, '@deepseek-ai/dsh', { disabled: true }),
      activeEntry(tree, '@deepseek-ai/dsh-web-app', { group: true }),
    ])

    const context = {
      baseUrl: import.meta.url,
      loader: tree,
      agents: { get: vi.fn() },
      get: vi.fn(() => undefined),
      deepseekLlmApiExtensions: {
        register: vi.fn((name: string, value: InventoryContribution) => {
          expect(name).toBe('dsh_plugin_packages')
          contribution = value
        }),
      },
    }

    apply(context as unknown as Context, {})
    expect(contribution).toBeDefined()

    const prepared = await contribution!.prepare({})
    expect(prepared.value).toEqual({
      version: 1,
      packages: [
        { name: 'dsh-plugin-desktop', version: '2.2.0-preview.1' },
        { name: 'dsh-plugin-gala', version: '2.2.0-preview.1' },
      ],
    })
    expect(JSON.stringify(prepared.value)).not.toMatch(/(?:path|config|credential|token)/i)
  })

  it('does not register the request extension when explicitly disabled', () => {
    const register = vi.fn()
    apply({ deepseekLlmApiExtensions: { register } } as unknown as Context, { enabled: false })
    expect(register).not.toHaveBeenCalled()
  })
})
