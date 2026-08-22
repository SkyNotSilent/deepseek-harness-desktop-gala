/**
 * `.ggal` 包读取（zip 格式）— PRD v4.0 §11.1 / §7.3
 *
 * `.ggal` 就是扩展名改过的普通 zip。这里实现最小只读解析：
 * 走中央目录（Central Directory）枚举条目，按需 inflate。
 * 只支持 stored(0) 与 deflate(8) 两种方法——市场包由官方工具产出，不需要更多。
 *
 * 解压前先按中央目录声明的解压后总大小做上限判定（§7.3 ≤ 50 MB），
 * 避免 zip bomb 把内存吃穿。
 */

import { inflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

/** 解压后单包总大小上限（PRD §7.3 / §11.4） */
export const MAX_EXTRACTED_BYTES = 50 * 1024 * 1024

/** 皮肤包大小上限（PRD §7.2） */
export const MAX_SKIN_BYTES = 10 * 1024 * 1024

/** zip 内一条已解出的文件条目 */
export interface GgalEntry {
  /** 包内相对路径（zip 内原样，使用 `/` 分隔） */
  path: string
  data: Buffer
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_MIN_SIZE = 22
/** EOCD 注释段最长 65535，回扫窗口取 EOCD 头 + 最长注释 */
const EOCD_SEARCH_WINDOW = EOCD_MIN_SIZE + 0xffff
const ZIP64_MARKER = 0xffffffff

const METHOD_STORED = 0
const METHOD_DEFLATE = 8

/** 从尾部回扫定位 EOCD 记录偏移；找不到说明不是 zip */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - EOCD_SEARCH_WINDOW)
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new Error('gala: 不是合法的 .ggal 包（找不到 zip 中央目录）')
}

/** 中央目录里的一条记录（尚未解压） */
interface CentralEntry {
  path: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

function readCentralDirectory(buffer: Buffer, eocdOffset: number): CentralEntry[] {
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (directoryOffset === ZIP64_MARKER || entryCount === 0xffff) {
    throw new Error('gala: 不支持 zip64 格式的 .ggal 包')
  }

  const entries: CentralEntry[] = []
  let cursor = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('gala: .ggal 中央目录损坏')
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const path = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    entries.push({ path, method, compressedSize, uncompressedSize, localHeaderOffset })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** 按本地文件头定位数据段并解压单条记录 */
function readEntryData(buffer: Buffer, entry: CentralEntry): Buffer {
  const header = entry.localHeaderOffset
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_SIGNATURE) {
    throw new Error(`gala: .ggal 条目头损坏 ${entry.path}`)
  }
  const nameLength = buffer.readUInt16LE(header + 26)
  const extraLength = buffer.readUInt16LE(header + 28)
  const start = header + 30 + nameLength + extraLength
  const raw = buffer.subarray(start, start + entry.compressedSize)
  if (entry.method === METHOD_STORED) return Buffer.from(raw)
  if (entry.method === METHOD_DEFLATE) return inflateRawSync(raw)
  throw new Error(`gala: .ggal 不支持的压缩方法 ${entry.method}（${entry.path}）`)
}

/**
 * 读出 `.ggal` 包内所有文件条目（目录项跳过）。
 *
 * 解压前按中央目录声明的总大小做 50 MB 上限判定（§7.3）；
 * 解压后再复核一次实际字节数，防止头部谎报。
 */
export function readGgalPackage(ggalPath: string, maxBytes = MAX_EXTRACTED_BYTES): readonly GgalEntry[] {
  const buffer = readFileSync(ggalPath)
  const eocdOffset = findEndOfCentralDirectory(buffer)
  const central = readCentralDirectory(buffer, eocdOffset).filter(entry => !entry.path.endsWith('/'))

  const declaredTotal = central.reduce((sum, entry) => sum + entry.uncompressedSize, 0)
  if (declaredTotal > maxBytes) {
    throw new Error(`gala: .ggal 解压后体积超限（${declaredTotal} > ${maxBytes} 字节）`)
  }

  const entries: GgalEntry[] = []
  let actualTotal = 0
  for (const entry of central) {
    const data = readEntryData(buffer, entry)
    actualTotal += data.byteLength
    if (actualTotal > maxBytes) {
      throw new Error(`gala: .ggal 解压后体积超限（> ${maxBytes} 字节）`)
    }
    entries.push({ path: entry.path, data })
  }
  return entries
}
