/** PNG静态图像预检：依据https://www.w3.org/TR/png-3/ 第5、7–11节。
 * 不是所有附属块/APNG帧的完整验证器，也不代替解码器或全局资源预算。
 * 校验CRC和关键块，再流式检查IDAT zlib/Adler32、扫描行长度及过滤类型。
 * 不保存解压图像；输出块至多16KiB，超出IHDR推导长度即中止。实际像素仍由媒体库解码。
 */
import { crc32, createInflate } from 'node:zlib'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const adam7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
const invalid = reason => new Error(`PNG预检失败：${reason}`)

export async function validatePngStructure(bytes, { signal } = {}) {
  signal?.throwIfAborted()
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) throw invalid('签名或头部截断')
  let header, palette = false, data = false, dataEnded = false, ended = false, compressedLength = 0
  for (let offset = 8; offset < bytes.length;) {
    if (bytes.length - offset < 12) throw invalid('块截断')
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (length > 0x7fffffff || end > bytes.length) throw invalid('块长度越界')
    for (const code of bytes.subarray(offset + 4, offset + 8)) if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) throw invalid('块名称无效')
    if (bytes[offset + 6] & 32) throw invalid('块名称保留位无效')
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid('CRC不一致')
    if (!header && type !== 'IHDR') throw invalid('首块不是IHDR')
    if (data && type !== 'IDAT') dataEnded = true
    if (type === 'IHDR') {
      if (header || length !== 13) throw invalid('IHDR重复或长度无效')
      const width = bytes.readUInt32BE(offset + 8), height = bytes.readUInt32BE(offset + 12)
      const depth = bytes[offset + 16], color = bytes[offset + 17], interlace = bytes[offset + 20]
      if (!width || !height || width > 0x7fffffff || height > 0x7fffffff || !depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || interlace > 1) throw invalid('IHDR参数无效')
      header = { width, height, depth, color, interlace }
    } else if (type === 'PLTE') {
      if (palette || data || !length || length % 3 || length > 768 || [0, 4].includes(header.color) || (header.color === 3 && length / 3 > 2 ** header.depth)) throw invalid('调色板无效或顺序错误')
      palette = true
    } else if (type === 'IDAT') {
      if (dataEnded || (header.color === 3 && !palette)) throw invalid('IDAT不连续或缺少调色板')
      data = true
      compressedLength += length
    } else if (type === 'IEND') {
      if (length || !data || end !== bytes.length) throw invalid('IEND无效、缺少IDAT或存在尾随数据')
      ended = true
    } else if (!(bytes[offset + 4] & 32)) throw invalid('未知关键块')
    offset = end
  }
  if (!ended || !compressedLength) throw invalid('缺少IEND或压缩数据')
  const passes = (header.interlace ? adam7 : [[0, 0, 1, 1]]).map(([x, y, dx, dy]) => {
    const width = Math.max(0, Math.ceil((header.width - x) / dx)), rows = Math.max(0, Math.ceil((header.height - y) / dy))
    return { rows: width ? rows : 0, stride: 1 + Math.ceil(width * channels[header.color] * header.depth / 8) }
  }).filter(pass => pass.rows)
  const expected = passes.reduce((sum, pass) => sum + pass.rows * pass.stride, 0)
  if (!Number.isSafeInteger(expected)) throw invalid('扫描行长度不可表示')
  // 第二次遍历生成小片段，不为大量空IDAT块建立数组，也不复制整段压缩数据。
  function* compressed() {
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset)
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
        for (let index = 0; index < length; index += 16384) yield bytes.subarray(offset + 8 + index, offset + 8 + Math.min(length, index + 16384))
      }
      offset += 12 + length
    }
  }
  let total = 0, passIndex = 0, row = 0, column = 0
  const inflate = createInflate({ chunkSize: 16384, readableHighWaterMark: 16384, writableHighWaterMark: 16384 })
  const sink = new Writable({ highWaterMark: 16384, write(chunk, _encoding, done) {
    try {
      total += chunk.length
      if (total > expected) throw invalid('解压数据超过扫描行预期')
      for (let position = 0; position < chunk.length;) {
        const pass = passes[passIndex]
        if (!pass) throw invalid('多余扫描行')
        if (column === 0 && chunk[position] > 4) throw invalid('过滤类型无效')
        const count = Math.min(chunk.length - position, pass.stride - column)
        column += count; position += count
        if (column === pass.stride) {
          column = 0
          if (++row === pass.rows) { row = 0; passIndex++ }
        }
      }
      done()
    } catch (error) { done(error) }
  } })
  try {
    // 流接口不一次性分配整图；sink在发现超量的首个至多16KiB块时销毁整条pipeline。
    // 此处约束单次PNG预检，不代表原生解码/并发请求的内存或CPU总预算。
    await pipeline(Readable.from(compressed(), { objectMode: false, highWaterMark: 16384 }), inflate, sink, { signal })
  } catch (error) { signal?.throwIfAborted(); throw invalid(`zlib或扫描行无效：${error.message}`) }
  signal?.throwIfAborted()
  if (total !== expected || passIndex !== passes.length || column !== 0 || inflate.bytesWritten !== compressedLength) throw invalid('扫描行不足或zlib流含尾随数据')
}
