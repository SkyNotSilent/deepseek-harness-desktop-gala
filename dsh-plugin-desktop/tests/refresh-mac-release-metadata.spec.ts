import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import { refreshMacReleaseMetadata } from '../scripts/refresh-mac-release-metadata.ts'

describe('macOS release metadata refresh', () => {
  it('rebuilds both blockmaps and updates latest-mac.yml from final artifact bytes', async () => {
    const writes = new Map<string, string>()
    const rebuild = vi.fn(async (artifactPath: string) => artifactPath.endsWith('.zip')
      ? { sha512: 'zip-final-sha', size: 101 }
      : { sha512: 'dmg-final-sha', size: 202 })

    await refreshMacReleaseMetadata({
      distDir: '/dist',
      version: '2.1.0-preview.3',
      arch: 'arm64',
      readText: () => `
version: 2.1.0-preview.3
files:
  - url: DeepSeek-Harness-Desktop-Gala-2.1.0-preview.3-arm64.zip
    sha512: old-zip
    size: 1
  - url: DeepSeek-Harness-Desktop-Gala-2.1.0-preview.3-arm64.dmg
    sha512: old-dmg
    size: 2
path: DeepSeek-Harness-Desktop-Gala-2.1.0-preview.3-arm64.zip
sha512: old-zip
`,
      writeText: (path, contents) => writes.set(path, contents),
      rebuildBlockMap: rebuild,
    })

    expect(rebuild).toHaveBeenCalledTimes(2)
    expect(rebuild).toHaveBeenNthCalledWith(
      1,
      '/dist/DeepSeek-Harness-Desktop-Gala-2.1.0-preview.3-arm64.zip',
      '/dist/DeepSeek-Harness-Desktop-Gala-2.1.0-preview.3-arm64.zip.blockmap',
    )
    expect(rebuild).toHaveBeenNthCalledWith(
      2,
      '/dist/DeepSeek-Harness-Desktop-Gala-2.1.0-preview.3-arm64.dmg',
      '/dist/DeepSeek-Harness-Desktop-Gala-2.1.0-preview.3-arm64.dmg.blockmap',
    )
    const result = parse(writes.get('/dist/latest-mac.yml')!) as {
      files: Array<{ url: string; sha512: string; size: number }>
      path: string
      sha512: string
    }
    expect(result.files).toEqual([
      {
        url: 'DeepSeek-Harness-Desktop-Gala-2.1.0-preview.3-arm64.zip',
        sha512: 'zip-final-sha',
        size: 101,
      },
      {
        url: 'DeepSeek-Harness-Desktop-Gala-2.1.0-preview.3-arm64.dmg',
        sha512: 'dmg-final-sha',
        size: 202,
      },
    ])
    expect(result.path).toBe('DeepSeek-Harness-Desktop-Gala-2.1.0-preview.3-arm64.zip')
    expect(result.sha512).toBe('zip-final-sha')
  })

  it('fails loudly when the updater manifest omits an artifact', async () => {
    await expect(refreshMacReleaseMetadata({
      distDir: '/dist',
      version: '2.1.0-preview.3',
      arch: 'arm64',
      readText: () => 'files: []\n',
      writeText: vi.fn(),
      rebuildBlockMap: vi.fn(),
    })).rejects.toThrow('latest-mac.yml is missing')
  })
})
