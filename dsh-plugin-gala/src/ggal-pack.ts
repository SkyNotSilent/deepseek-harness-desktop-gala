/**
 * `.ggal` 包写侧（zip 组装 + manifest 摘要）— PRD v4.0 §11.1 / §11.2
 *
 * 与读侧 src/ggal-zip.ts 对称的最小 zip 子集（stored / deflate）。
 * 由造包 CLI（scripts/build-gala-packs.ts）与测试夹具共用；
 * g16 保留一条系统 `zip` CLI 交叉验证，防读写两侧同错。
 */

import { deflateRawSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import type { MarketManifest } from './protocols/market-manifest.ts'
import type { GalaCharacter } from './protocols/gala-json.ts'

/** 待打包的一个文件条目 */
export interface PackEntry {
  /** 包内相对路径（`/` 分隔） */
  path: string
  data: Buffer | string
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 把条目打成 zip 字节流；'deflate' 生产用，'store' 便于调试 */
export function buildZip(entries: readonly PackEntry[], method: 'store' | 'deflate' = 'store'): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const compressed = method === 'deflate' ? deflateRawSync(raw) : raw
    const name = Buffer.from(entry.path, 'utf8')
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method === 'deflate' ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.byteLength, 18)
    local.writeUInt32LE(raw.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    locals.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method === 'deflate' ? 8 : 0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.byteLength, 20)
    central.writeUInt32LE(raw.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.byteLength + name.byteLength + compressed.byteLength
  }

  const localBytes = Buffer.concat(locals)
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBytes.byteLength, 12)
  eocd.writeUInt32LE(localBytes.byteLength, 16)
  return Buffer.concat([localBytes, centralBytes, eocd])
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** payload 摘要：按 files 顺序对 `<路径>\n<该文件sha256>\n` 串联再 sha256（§11.2） */
export function payloadDigest(entries: readonly PackEntry[], files: readonly string[]): string {
  const byPath = new Map(
    entries.map(entry => [entry.path, Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')]),
  )
  const hash = createHash('sha256')
  for (const path of files) {
    const data = byPath.get(path)
    if (data === undefined) throw new Error(`ggal-pack: manifest 声明的文件缺失 ${path}`)
    hash.update(`${path}\n${sha256Hex(data)}\n`)
  }
  return hash.digest('hex')
}

/** 一个包的组装输入 */
export interface PackageInput {
  /** gala.json 元数据（皮肤包用带 skin 字段的对象也可） */
  character: GalaCharacter
  /** gala.json 之外的附加文件 */
  extras?: readonly PackEntry[]
  /** 覆盖 manifest 字段（测试构造非法包用） */
  manifestOverrides?: Partial<MarketManifest>
}

/** 组装完整包内容条目（manifest.json + gala.json + extras，摘要已算好） */
export function ggalEntries(input: PackageInput): PackEntry[] {
  const { character, extras = [], manifestOverrides = {} } = input
  const payload: PackEntry[] = [
    { path: 'gala.json', data: `${JSON.stringify(character, null, 2)}\n` },
    ...extras,
  ]
  const files = payload.map(entry => entry.path)
  const manifest: MarketManifest = {
    schema: '1.0',
    id: character.id,
    type: character.type,
    version: character.version,
    author: character.author,
    files,
    sha256: payloadDigest(payload, files),
    ...manifestOverrides,
  }
  return [{ path: 'manifest.json', data: `${JSON.stringify(manifest, null, 2)}\n` }, ...payload]
}

/** 把包写到磁盘，返回 `.ggal` 路径 */
export function writeGgal(
  path: string,
  input: PackageInput,
  method: 'store' | 'deflate' = 'deflate',
): string {
  writeFileSync(path, buildZip(ggalEntries(input), method))
  return path
}
