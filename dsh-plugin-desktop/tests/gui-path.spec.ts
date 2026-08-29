import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recoverGuiPath, type GuiPathFilesystem } from '../src/gui-path.ts'

function filesystem(
  files: Readonly<Record<string, string>>,
  directories: readonly string[] = [],
  listings: Readonly<Record<string, readonly string[]>> = {},
): GuiPathFilesystem {
  return {
    read: path => files[path],
    list: path => listings[path] ?? [],
    isDirectory: path => directories.includes(path),
  }
}

describe('Finder-safe GUI PATH recovery', () => {
  it('merges app commands, inherited PATH, system paths, sorted paths.d, and existing standard paths', () => {
    const home = '/Users/example'
    const result = recoverGuiPath({
      platform: 'darwin',
      currentPath: '/usr/bin:/bin:/temporarily/offline',
      appCommandDir: '/private/app commands',
      homeDir: home,
      filesystem: filesystem({
        '/etc/paths': '/usr/local/bin\n/usr/bin\n',
        '/etc/paths.d/10-toolchain': '/toolchain/bin\n/usr/bin\n',
        '/etc/paths.d/90-late': '/late/bin\n',
      }, [
        '/opt/homebrew/bin',
        join(home, '.local/bin'),
      ], {
        '/etc/paths.d': ['90-late', '10-toolchain'],
      }),
    })

    expect(result).toEqual({
      value: [
        '/private/app commands',
        '/usr/bin',
        '/bin',
        '/temporarily/offline',
        '/usr/local/bin',
        '/toolchain/bin',
        '/late/bin',
        '/opt/homebrew/bin',
        join(home, '.local/bin'),
      ].join(':'),
      added: 5,
      source: 'macos-system-paths',
    })
  })

  it.each([undefined, ''])('handles a minimal Finder PATH of %s without invoking shell startup files', (currentPath) => {
    const reads: string[] = []
    const fs: GuiPathFilesystem = {
      read: path => {
        reads.push(path)
        return path === '/etc/paths' ? '/usr/bin\n/bin\n' : undefined
      },
      list: () => [],
      isDirectory: () => false,
    }
    const result = recoverGuiPath({
      platform: 'darwin',
      currentPath,
      appCommandDir: '/app/bin',
      homeDir: '/Users/example',
      filesystem: fs,
    })

    expect(result.value).toBe('/app/bin:/usr/bin:/bin')
    expect(reads).toEqual(['/etc/paths'])
    expect(reads.every(path => !/\.(?:zshrc|zprofile|bashrc|profile)$/u.test(path))).toBe(true)
  })

  it('only prepends and deduplicates the app command directory away from macOS', () => {
    expect(recoverGuiPath({
      platform: 'linux',
      currentPath: '/app/bin:/usr/bin:/app/bin',
      appCommandDir: '/app/bin',
      homeDir: '/home/example',
    })).toEqual({
      value: '/app/bin:/usr/bin',
      added: 0,
      source: 'unchanged',
    })
  })
})
