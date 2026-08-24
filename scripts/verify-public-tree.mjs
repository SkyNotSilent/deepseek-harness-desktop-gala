import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

const privateBasenames = new Set([
  'A' + 'GENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'MEMORY.md',
  'project-status.md',
  '.DS_Store',
])
const generatedSegments = new Set(['node_modules', 'dist', 'coverage'])

const rejected = tracked.filter((file) => {
  if (privateBasenames.has(basename(file))) return true
  return file.split('/').some((segment) => generatedSegments.has(segment))
})

if (rejected.length > 0) {
  console.error('Public tree contains local-only or generated files:')
  for (const file of rejected) console.error(`- ${file}`)
  process.exit(1)
}

console.log(`Public tree verified: ${tracked.length} tracked files`)
