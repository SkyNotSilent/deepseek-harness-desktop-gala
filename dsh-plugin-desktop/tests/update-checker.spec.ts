import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_RELEASES_URL,
  DESKTOP_VERSION_ENDPOINT,
  MAX_VERSION_RESPONSE_BYTES,
  checkForStableUpdate,
  compareSemVerVersions,
  parseSemVer,
  type UpdateRequest,
} from '../src/update-checker.ts'

function release(version: string, options: { draft?: boolean; url?: string } = {}): object {
  return {
    tag_name: `v${version}`,
    html_url: options.url ?? `${DESKTOP_RELEASES_URL}/tag/v${version}`,
    draft: options.draft ?? false,
    prerelease: version.includes('-'),
  }
}

describe('strict SemVer parsing', () => {
  it('parses prerelease/build metadata and compares without numeric overflow', () => {
    expect(parseSemVer('v2.10.3-preview.1+mac.arm64')).toMatchObject({
      version: '2.10.3-preview.1+mac.arm64',
      prerelease: ['preview', '1'],
      build: ['mac', 'arm64'],
    })
    expect(compareSemVerVersions('10000000000000000.0.0', '9007199254740992.0.0'))
      .toBeGreaterThan(0)
  })

  it.each(['1.2', '01.2.3', '1.2.3-01', 'V1.2.3', ' 1.2.3'])('rejects %s', value => {
    expect(parseSemVer(value)).toBeNull()
  })

  it.each([
    ['0.0.0', [], []],
    ['1.0.0', [], []],
    ['10.20.30', [], []],
    ['999999999999999999.0.1', [], []],
    ['1.2.3-alpha', ['alpha'], []],
    ['1.2.3-alpha.1', ['alpha', '1'], []],
    ['1.2.3-0', ['0'], []],
    ['1.2.3-rc-1', ['rc-1'], []],
    ['1.2.3+build', [], ['build']],
    ['1.2.3+001', [], ['001']],
    ['1.2.3-alpha+build', ['alpha'], ['build']],
    ['1.2.3-alpha.1+mac.arm64', ['alpha', '1'], ['mac', 'arm64']],
    ['v1.2.3', [], []],
    ['v1.2.3-preview.9', ['preview', '9'], []],
    ['v0.0.0-dev+local.1', ['dev'], ['local', '1']],
  ] as const)('accepts strict version %s', (value, prerelease, build) => {
    expect(parseSemVer(value)).toMatchObject({ prerelease, build })
  })

  it.each([
    '',
    'v',
    '1',
    '1.2.',
    '.1.2.3',
    '1.2.3.',
    '1.2.3-',
    '1.2.3+',
    '1.2.3-alpha..1',
    '1.2.3+build..1',
    '1.2.3_alpha',
    '1.2.3-alpha!',
    '1.2.3+build!',
    '1.2.3\n',
    '+1.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-00',
    'vv1.2.3',
    '1.2.3.4',
  ])('rejects malformed contract value %j', value => {
    expect(parseSemVer(value)).toBeNull()
  })

  it.each([
    ['0.0.0', '0.0.0', 0],
    ['1.0.0', '2.0.0', -1],
    ['2.0.0', '1.9.9', 1],
    ['1.1.0', '1.2.0', -1],
    ['1.2.1', '1.2.0', 1],
    ['1.2.3-alpha', '1.2.3', -1],
    ['1.2.3', '1.2.3-alpha', 1],
    ['1.2.3-alpha', '1.2.3-beta', -1],
    ['1.2.3-alpha', '1.2.3-alpha.1', -1],
    ['1.2.3-alpha.1', '1.2.3-alpha.beta', -1],
    ['1.2.3-beta.2', '1.2.3-beta.11', -1],
    ['1.2.3-rc.2', '1.2.3-rc.1', 1],
    ['1.2.3+mac', '1.2.3+win', 0],
    ['v1.2.3', '1.2.3', 0],
    ['10000000000000000.0.0', '9007199254740992.0.0', 1],
    ['1.2.3-1', '1.2.3-alpha', -1],
    ['1.2.3-alpha.9', '1.2.3-alpha.10', -1],
    ['1.2.3-alpha.z', '1.2.3-alpha.zz', -1],
    ['1.10.0', '1.9.999', 1],
    ['10.0.0-preview.1', '9.999.999', 1],
  ] as const)('orders %s against %s', (left, right, expected) => {
    expect(Math.sign(compareSemVerVersions(left, right)!)).toBe(expected)
  })
})

describe('public GitHub Release checks', () => {
  it('uses only the fixed public repository and selects the newest Preview', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const request: UpdateRequest = async (url, init) => {
      calls.push({ url, init })
      return Response.json([release('2.1.0-preview.2'), release('2.1.0-preview.1')])
    }

    await expect(checkForStableUpdate({ currentVersion: '2.1.0-preview.1', request }))
      .resolves.toEqual({
        status: 'update-available',
        currentVersion: '2.1.0-preview.1',
        latestVersion: '2.1.0-preview.2',
        releaseUrl: `${DESKTOP_RELEASES_URL}/tag/v2.1.0-preview.2`,
      })
    expect(calls[0]?.url).toBe(DESKTOP_VERSION_ENDPOINT)
    expect(calls[0]?.url).toBe('https://api.github.com/repos/SkyNotSilent/deepseek-harness-desktop-gala/releases?per_page=5')
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('x-github-api-version')).toBe('2022-11-28')
    expect(headers.get('accept')).toBe('application/vnd.github+json')
  })

  it('keeps stable builds on the stable channel', async () => {
    await expect(checkForStableUpdate({
      currentVersion: '2.1.0',
      request: async () => Response.json([
        release('2.2.0-preview.1'),
        release('2.1.1'),
      ]),
    })).resolves.toMatchObject({ status: 'update-available', latestVersion: '2.1.1' })
  })

  it('ignores a GitHub prerelease even when its tag looks stable', async () => {
    await expect(checkForStableUpdate({
      currentVersion: '2.1.0',
      request: async () => Response.json([
        { ...release('2.2.0'), prerelease: true },
        release('2.1.1'),
      ]),
    })).resolves.toMatchObject({ status: 'update-available', latestVersion: '2.1.1' })
  })

  it('ignores drafts, malformed tags, and untrusted release URLs', async () => {
    await expect(checkForStableUpdate({
      currentVersion: '2.1.0-preview.1',
      request: async () => Response.json([
        release('9.0.0', { draft: true }),
        { ...release('8.0.0'), tag_name: '8.0.0' },
        release('7.0.0', { url: 'https://evil.example/release' }),
        { tag_name: 'v6.0.0', html_url: `${DESKTOP_RELEASES_URL}/tag/v6.0.0` },
      ]),
    })).resolves.toBeNull()
  })

  it('returns null for network, status, schema, size, and invalid installed versions', async () => {
    await expect(checkForStableUpdate({
      currentVersion: '2.1.0',
      request: async () => { throw new TypeError('offline') },
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      currentVersion: '2.1.0',
      request: async () => new Response(null, { status: 403 }),
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      currentVersion: '2.1.0',
      request: async () => Response.json({ tag_name: 'v2.2.0' }),
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      currentVersion: '2.1.0',
      request: async () => new Response('x'.repeat(MAX_VERSION_RESPONSE_BYTES + 1)),
    })).resolves.toBeNull()
    const request = vi.fn(async () => Response.json([release('2.2.0')]))
    await expect(checkForStableUpdate({ currentVersion: 'v2.1.0', request })).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
  })
})
