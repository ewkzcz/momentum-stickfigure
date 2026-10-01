/** 仅2048²容量测量夹具；不复制生产验证算法，不修改已有小图夹具。
 * 纹理采用坐标混合固定种子；16位PNG保留低8位信息，纯色全部为不透明像素。
 */
import { createCanvas } from '@napi-rs/canvas'
import { createDeflate } from 'node:zlib'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pngSignature, pngChunk } from './png-media-fixtures.mjs'

export const capacitySize = 2048
export const capacitySeed = 0x347ac157
export const capacitySamples = ['png', 'jpeg', 'webp', 'png-adam7', 'png-16bit'].flatMap(variant =>
  ['solid', 'texture'].map(pattern => ({ variant, pattern })))
function samples(x, y, pattern) {
  if (pattern === 'solid') return [0x3434, 0x7a7a, 0xc1c1, 65535]
  let value = (capacitySeed ^ Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x119de1f3)) >>> 0
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0
  value = (value ^ (value >>> 16)) >>> 0
  return [value & 65535, (value >>> 8) & 65535, (Math.imul(value, 0x27d4eb2d) >>> 16) & 65535, 65535]
}
async function specialPng(pattern, interlace, depth) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(capacitySize); header.writeUInt32BE(capacitySize, 4)
  header[8] = depth; header[9] = 6; header[12] = interlace
  // 标准Adam7七个pass的像素遍历，仅用于编码合法夹具；每次生成一条扫描行。
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]
  function* rows() {
    for (const [startX, startY, stepX, stepY] of passes) {
      const width = Math.ceil((capacitySize - startX) / stepX)
      for (let y = startY; y < capacitySize; y += stepY) {
        const row = Buffer.alloc(1 + width * 4 * depth / 8) // filter None，首字节0。
        let offset = 1
        for (let x = startX; x < capacitySize; x += stepX) for (const value of samples(x, y, pattern)) {
          if (depth === 16) { row.writeUInt16BE(value, offset); offset += 2 }
          else row[offset++] = value >>> 8
        }
        yield row
      }
    }
  }
  const chunks = [pngSignature, pngChunk('IHDR', header)]
  const sink = new Writable({ write(chunk, _encoding, done) {
    try { chunks.push(pngChunk('IDAT', chunk)); done() } catch (error) { done(error) }
  } })
  await pipeline(Readable.from(rows(), { objectMode: false, highWaterMark: 32768 }), createDeflate({ level: 6, chunkSize: 16384 }), sink)
  chunks.push(pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(chunks)
}
export async function capacityFixture({ variant, pattern }) {
  if (!capacitySamples.some(item => item.variant === variant && item.pattern === pattern)) throw new Error('只允许固定2048²容量样本')
  if (variant === 'png-adam7') return specialPng(pattern, 1, 8)
  if (variant === 'png-16bit') return specialPng(pattern, 0, 16)
  const canvas = createCanvas(capacitySize, capacitySize), context = canvas.getContext('2d')
  if (pattern === 'solid') {
    context.fillStyle = '#347ac1'; context.fillRect(0, 0, capacitySize, capacitySize)
  } else {
    const image = context.createImageData(capacitySize, capacitySize)
    let offset = 0
    for (let y = 0; y < capacitySize; y++) for (let x = 0; x < capacitySize; x++) {
      for (const value of samples(x, y, pattern)) image.data[offset++] = value >>> 8
    }
    context.putImageData(image, 0, 0)
  }
  return canvas.toBuffer(`image/${variant}`)
}
