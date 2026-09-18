/** 独立小PNG夹具：只生成零值样本，扫描行按坐标枚举，避免分配大图。 */
import { crc32, deflateSync } from 'node:zlib'
export const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
export function pngChunk(type, data) {
  const output = Buffer.alloc(data.length + 12)
  output.writeUInt32BE(data.length)
  output.write(type, 4, 4, 'ascii')
  data.copy(output, 8)
  output.writeUInt32BE(crc32(output.subarray(4, output.length - 4)), output.length - 4)
  return output
}
export function pngFixture({ color = 6, depth = 8, interlace = 0, filter = 0, width = 9, height = 7, payload, rawTransform = raw => raw, split = false } = {}) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4)
  header[8] = depth; header[9] = color; header[12] = interlace
  const samples = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color]
  // Adam7每个8x8位置所属pass，来自PNG标准的pass图；与产品按起点/步长推导分离。
  const pattern = [[1, 6, 4, 6, 2, 6, 4, 6], [7, 7, 7, 7, 7, 7, 7, 7], [5, 6, 5, 6, 5, 6, 5, 6], [7, 7, 7, 7, 7, 7, 7, 7], [3, 6, 4, 6, 3, 6, 4, 6], [7, 7, 7, 7, 7, 7, 7, 7], [5, 6, 5, 6, 5, 6, 5, 6], [7, 7, 7, 7, 7, 7, 7, 7]]
  const rows = []
  for (let pass = 1; pass <= (interlace ? 7 : 1); pass++) for (let y = 0; y < height; y++) {
    let pixels = 0
    for (let x = 0; x < width; x++) if (!interlace || pattern[y % 8][x % 8] === pass) pixels++
    if (pixels) {
      const row = Buffer.alloc(1 + Math.ceil(pixels * samples * depth / 8))
      row[0] = filter
      rows.push(row)
    }
  }
  const raw = rawTransform(Buffer.concat(rows))
  const compressed = payload === undefined ? deflateSync(raw) : payload
  const chunks = [pngChunk('IHDR', header)]
  if (color === 3) chunks.push(pngChunk('PLTE', Buffer.from([0, 0, 0, 255, 255, 255])))
  chunks.push(pngChunk('tEXt', Buffer.from('Comment\0fixture')))
  if (split) {
    chunks.push(pngChunk('IDAT', Buffer.alloc(0)), pngChunk('IDAT', compressed.subarray(0, 1)), pngChunk('IDAT', compressed.subarray(1, -3)))
    // zlib头、Adler32均跨块，另含尾部零长度块；块边界不能被当成流边界。
    for (const byte of compressed.subarray(-3)) chunks.push(pngChunk('IDAT', Buffer.from([byte])))
    chunks.push(pngChunk('IDAT', Buffer.alloc(0)))
  } else chunks.push(pngChunk('IDAT', compressed))
  chunks.push(pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat([pngSignature, ...chunks])
}
