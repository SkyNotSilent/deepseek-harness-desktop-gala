import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  previewAssetNames,
  publishPreview,
  type PublishPreviewOptions,
} from '../scripts/publish-preview.ts'

const VERSION = '2.1.0-preview.3'
const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-publish-preview-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function harness(overrides: Partial<PublishPreviewOptions> = {}) {
  const desktopRoot = temporaryDirectory()
  const dist = join(desktopRoot, 'dist')
  mkdirSync(dist)
  const names = previewAssetNames(VERSION)
  const macNames = names.filter(name => !name.endsWith('-Setup.exe'))
  for (const name of macNames) writeFileSync(join(dist, name), `local:${name}`)
  const remote = new Map<string, Buffer>([[
    names.find(name => name.endsWith('-Setup.exe'))!,
    Buffer.from('signed windows installer'),
  ]])
  const commands: Array<{ command: string; args: readonly string[] }> = []
  const verifications: Array<{ directory: string; teamId: string }> = []
  const removals: string[] = []
  const logs: string[] = []
  const options: PublishPreviewOptions = {
    desktopRoot,
    version: VERSION,
    teamId: 'TEAM123456',
    platform: 'darwin',
    run: (command, args) => {
      commands.push({ command, args: [...args] })
      if (args[0] === 'release' && args[1] === 'view') {
        return { stdout: JSON.stringify({ tagName: `v${VERSION}`, isDraft: true, isPrerelease: true }), stderr: '' }
      }
      if (args[0] === 'release' && args[1] === 'upload') {
        for (const candidate of args.slice(3)) {
          if (candidate.startsWith('--')) break
          remote.set(basename(candidate), readFileSync(candidate))
        }
      }
      if (args[0] === 'release' && args[1] === 'download') {
        const output = args[args.indexOf('--dir') + 1]!
        mkdirSync(output, { recursive: true })
        for (const [name, value] of remote) writeFileSync(join(output, name), value)
      }
      return { stdout: '', stderr: '' }
    },
    makeTemporaryDirectory: temporaryDirectory,
    removeTemporaryDirectory: path => { removals.push(path); rmSync(path, { force: true, recursive: true }) },
    listFiles: directory => readdirSync(directory).map(name => join(directory, name)).filter(path => statSync(path).isFile()),
    read: readFileSync,
    write: (path, value) => writeFileSync(path, value),
    size: path => statSync(path).size,
    verifyMac: (directory, teamId) => { verifications.push({ directory, teamId }) },
    log: message => logs.push(message),
    ...overrides,
  }
  return { commands, desktopRoot, logs, names, options, remote, removals, verifications }
}

describe('draft preview publishing gate', () => {
  it('uploads signed macOS files, re-downloads twice, checksums, verifies, then publishes', () => {
    const state = harness()
    publishPreview(state.options)

    expect([...state.remote.keys()].sort()).toEqual([...state.names, 'SHA256SUMS.txt'].sort())
    expect(state.verifications).toHaveLength(2)
    expect(state.verifications[0]).toEqual({ directory: join(state.desktopRoot, 'dist'), teamId: 'TEAM123456' })
    const editIndex = state.commands.findIndex(call => call.args[1] === 'edit')
    const downloads = state.commands.map((call, index) => ({ call, index })).filter(({ call }) => call.args[1] === 'download')
    expect(downloads).toHaveLength(2)
    expect(editIndex).toBeGreaterThan(downloads[1]!.index)
    expect(state.commands[editIndex]?.args).toContain('--draft=false')
    expect(state.logs).toEqual([`published verified prerelease v${VERSION}`])
    expect(state.removals).toHaveLength(2)
  })

  it('leaves the release as a draft when final downloaded verification fails', () => {
    let verification = 0
    const state = harness({
      verifyMac: () => {
        verification += 1
        if (verification === 2) throw new Error('downloaded Gatekeeper failure')
      },
    })
    expect(() => publishPreview(state.options)).toThrow('downloaded Gatekeeper failure')
    expect(state.commands.some(call => call.args[1] === 'edit')).toBe(false)
    expect(state.removals).toHaveLength(2)
  })

  it('refuses a non-draft release before uploading any asset', () => {
    const state = harness({
      run: (command, args) => {
        state.commands.push({ command, args: [...args] })
        return { stdout: JSON.stringify({ tagName: `v${VERSION}`, isDraft: false, isPrerelease: true }), stderr: '' }
      },
    })
    expect(() => publishPreview(state.options)).toThrow('must exist as a draft prerelease')
    expect(state.commands).toHaveLength(1)
  })
})
