/**
 * 自制 PSD 回归素材：用整数像素生成独立蒙版、剪切组及混合模式三个小人物文件。
 * 图组沿用人物页默认名称，每组保留可见项和隐藏替换项，供真实页面选择与显隐场景使用。
 * 仅写入调用方明确指定的新测试目录；不覆盖文件，不接触用户配置，不依赖字体、时钟或随机像素。
 * 素材合成图只用于补全文档，绝不能作为页面回归的预期图；现有图像转换结果须由原业务记录。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeCanvas, readPsd, writePsdBuffer } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const size = 96
const variants = ['layer-mask', 'clipping-group', 'blend-modes']

/** 用无抗锯齿的整数矩形创建局部画布，不读取外部素材或系统字体。 */
function rectangleCanvas(width, height, rectangles) {
  // 1、透明底上按固定次序绘制，矩形格式为 [x, y, 宽, 高, 颜色]。
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  for (const [x, y, w, h, color] of rectangles) {
    context.fillStyle = color
    context.fillRect(x, y, w, h)
  }
  return canvas
}

/** 创建具有明确偏移及边界的栅格图层；特殊 PSD 属性独立保存在元数据中。 */
function layer(name, left, top, width, height, rectangles, extra = {}) {
  // 1、图像本身不预先应用蒙版、剪切或混合模式，以便验证原业务处理这些属性的现状。
  return { name, left, top, right: left + width, bottom: top + height,
    opacity: 1, blendMode: 'normal', hidden: false, clipping: false,
    canvas: rectangleCanvas(width, height, rectangles), ...extra }
}

/** 创建隔离的普通图组，数组遵循 ag-psd 的自底向上堆叠约定。 */
function group(name, children, hidden = false) {
  // 1、显式记录图组显隐及混合模式，不让组名替代真正的 PSD 分组结构。
  return { name, children, hidden, opened: true, opacity: 1, blendMode: 'normal' }
}

/** 创建衣服的透明底形状，使剪切图层越界部分和底层透明区域均可被观察。 */
function shirt(name = '衣服底色', extra = {}) {
  // 1、肩部、袖子及腰部分别占据不同区域，边缘保留透明像素。
  return layer(name, 32, 40, 32, 30, [
    [6, 0, 20, 12, '#4e8cbc'], [0, 8, 32, 10, '#4e8cbc'], [5, 18, 22, 12, '#4e8cbc']
  ], extra)
}

/** 为三份素材分别添加真实图层蒙版、连续剪切层或非剪切混合层。 */
function featureLayers(variant) {
  // 1、蒙版使用与图层不同的尺寸及偏移，并保存黑、灰、白三个独立灰度区域。
  if (variant === 'layer-mask') {
    return [shirt('独立图层蒙版', { mask: {
      left: 36, top: 44, right: 57, bottom: 64, defaultColor: 0,
      disabled: false, positionRelativeToLayer: false,
      canvas: rectangleCanvas(21, 20, [
        [0, 0, 7, 20, '#000000'], [7, 0, 7, 20, '#808080'], [14, 0, 7, 20, '#ffffff']
      ])
    } })]
  }
  // 2、两个连续剪切层指向同一非剪切底层，图像边界故意超过底层形状。
  if (variant === 'clipping-group') {
    return [shirt(),
      layer('剪切阴影', 24, 36, 48, 38, [[0, 0, 48, 38, '#8060a0']], { clipping: true, blendMode: 'multiply' }),
      layer('剪切高光', 22, 42, 52, 12, [[0, 0, 52, 12, '#70c0e0']], { clipping: true, blendMode: 'screen' })]
  }
  // 3、相互重叠但不剪切的三种混合模式，另含非满值透明度。
  assert.equal(variant, 'blend-modes')
  return [shirt(),
    layer('正片叠底', 34, 42, 16, 26, [[0, 0, 16, 26, '#905070']], { blendMode: 'multiply' }),
    layer('滤色', 44, 44, 16, 22, [[0, 0, 16, 22, '#4080c0']], { blendMode: 'screen' }),
    layer('叠加', 39, 51, 18, 10, [[0, 0, 18, 10, '#d0a060']], { blendMode: 'overlay', opacity: 0.6 })]
}

/** 构造人物页能识别的前手、上身、下身和表情，每个分类都有隐藏替换项。 */
function characterLayers(variant) {
  // 1、身体分组和固定头部确保切换一个分组时仍有其它可见内容。
  return [
    group('下身', [
      layer('站立', 35, 68, 26, 20, [[0, 0, 10, 20, '#34445c'], [16, 0, 10, 20, '#34445c']]),
      layer('迈步', 31, 68, 34, 20, [[0, 0, 11, 20, '#54647c'], [23, 0, 11, 20, '#54647c']], { hidden: true })
    ]),
    group('上身', [
      group('常服', featureLayers(variant)),
      group('替换服', [shirt('替换衣服', { opacity: 0.8 })], true)
    ]),
    layer('头部', 35, 12, 26, 26, [[3, 0, 20, 26, '#edbd91'], [0, 5, 26, 16, '#edbd91']]),
    group('前手', [
      layer('自然垂手', 23, 44, 11, 26, [[3, 0, 8, 26, '#edbd91']]),
      layer('招手', 20, 28, 14, 32, [[0, 0, 8, 24, '#edbd91'], [0, 22, 14, 10, '#edbd91']], { hidden: true })
    ]),
    group('表情', [
      layer('平静', 40, 21, 16, 12, [[0, 0, 3, 3, '#302834'], [13, 0, 3, 3, '#302834'], [5, 9, 6, 2, '#8c4048']]),
      layer('微笑', 40, 21, 16, 12, [[0, 0, 4, 2, '#302834'], [12, 0, 4, 2, '#302834'], [4, 7, 8, 2, '#8c4048'], [6, 9, 4, 2, '#8c4048']], { hidden: true })
    ])
  ]
}

/** 仅为本文件的固定素材补全文档合成图；页面测试不得以它作为正确性参考。 */
function fixtureComposite(layers) {
  // 1、使用原生画布绘制固定素材组，隐藏项不进入文档封面。
  const output = createCanvas(size, size)
  const context = output.getContext('2d')
  let clippingBase = null
  for (const item of layers) {
    const surface = createCanvas(size, size)
    const local = surface.getContext('2d')
    if (item.children) local.drawImage(fixtureComposite(item.children), 0, 0)
    else local.drawImage(item.canvas, item.left, item.top)
    // 2、素材仅包含启用、默认黑色的普通蒙版，用独立灰度通道构造封面透明度。
    if (item.mask) {
      const { width, height } = item.mask.canvas
      const pixels = item.mask.canvas.getContext('2d').getImageData(0, 0, width, height)
      for (let index = 0; index < pixels.data.length; index += 4) pixels.data[index + 3] = pixels.data[index]
      const alpha = createCanvas(size, size)
      alpha.getContext('2d').putImageData(pixels, item.mask.left, item.mask.top)
      local.globalCompositeOperation = 'destination-in'
      local.drawImage(alpha, 0, 0)
    }
    // 3、封面剪切只取当前底层透明度；PSD 内仍保留未经裁切的原图与 clipping 标志。
    if (!item.clipping) clippingBase = item.hidden ? createCanvas(size, size) : surface
    if (item.hidden) continue
    if (item.clipping) {
      assert.ok(clippingBase, '剪切层必须有在下方的非剪切底层')
      local.globalCompositeOperation = 'destination-in'
      local.drawImage(clippingBase, 0, 0)
    }
    context.globalAlpha = item.opacity
    context.globalCompositeOperation = item.blendMode === 'normal' ? 'source-over' : item.blendMode
    context.drawImage(surface, 0, 0)
  }
  return output
}

/** 递归列出图层及中文路径，供真实 PSD 读回的结构断言和诊断共用。 */
function flatten(layers, parent = '') {
  // 1、保持原始图层顺序，不用随机标识替代稳定路径。
  return layers.flatMap((item) => {
    const layerPath = parent ? `${parent}/${item.name}` : item.name
    return [{ item, path: layerPath }, ...flatten(item.children || [], layerPath)]
  })
}

/** 从实际 PSD 字节重新解析并验证关键属性；不会推断人物页渲染应当是什么样。 */
function verifyPsd(bytes, variant) {
  // 1、使用原始像素读回，避开画布预乘透明度对结构证据的影响。
  const psd = readPsd(bytes, { useImageData: true, skipThumbnail: true, throwForMissingFeatures: true })
  assert.equal(psd.width, size)
  assert.equal(psd.height, size)
  assert.ok(psd.imageData.data.some((value, index) => index % 4 === 3 && value > 0), '文档合成图不能为空')
  const entries = flatten(psd.children)
  for (const name of ['前手', '上身', '下身', '表情']) {
    const found = psd.children.find((item) => item.name === name)
    assert.equal(found?.children?.length, 2, `${name}必须包含两个可选部件`)
    assert.equal(found.children[0].hidden, false)
    assert.equal(found.children[1].hidden, true)
  }
  const features = psd.children.find((item) => item.name === '上身').children[0].children
  // 2、检查蒙版确实独立于图层，含不同边界及黑灰白区域，原图尚未被蒙版裁切。
  if (variant === 'layer-mask') {
    const item = features[0]
    assert.equal(item.clipping, false)
    assert.equal(item.mask.disabled, false)
    assert.equal(item.mask.defaultColor, 0)
    assert.deepEqual([item.mask.left, item.mask.top, item.mask.right, item.mask.bottom], [36, 44, 57, 64])
    assert.deepEqual([item.mask.imageData.width, item.mask.imageData.height], [21, 20])
    assert.deepEqual([...new Set(item.mask.imageData.data.filter((_value, index) => index % 4 === 0))].sort((a, b) => a - b), [0, 128, 255])
    assert.equal(item.imageData.data[((44 - item.top) * item.imageData.width + 39 - item.left) * 4 + 3], 255)
    assert.equal(item.mask.imageData.data[(39 - item.mask.left) * 4], 0)
  }
  // 3、检查剪切层共享底层且超过其范围；普通混合模式文件不得意外变成剪切层。
  if (variant === 'clipping-group') {
    assert.deepEqual(features.map((item) => item.clipping), [false, true, true])
    assert.deepEqual(features.map((item) => item.blendMode), ['normal', 'multiply', 'screen'])
    assert.ok(features[1].left < features[0].left && features[1].right > features[0].right)
    assert.ok(features[2].left < features[0].left && features[2].right > features[0].right)
  }
  if (variant === 'blend-modes') {
    assert.deepEqual(features.map((item) => item.blendMode), ['normal', 'multiply', 'screen', 'overlay'])
    assert.ok(features.every((item) => !item.clipping))
    assert.equal(features[3].opacity, 0.6)
  }
  // 4、输出可以保留到测试日志的结构证据，而非像素正确性结论。
  return { variant, width: size, height: size, bytes: bytes.length,
    groups: entries.filter(({ item }) => item.children).map(({ path: name }) => name),
    masks: entries.filter(({ item }) => item.mask).map(({ item, path: name }) => ({ path: name, disabled: item.mask.disabled,
      bounds: [item.mask.left, item.mask.top, item.mask.right, item.mask.bottom], defaultColor: item.mask.defaultColor, grayscale: [0, 128, 255] })),
    clipping: entries.filter(({ item }) => item.clipping).map(({ path: name }) => name),
    blendModes: [...new Set(entries.map(({ item }) => item.blendMode))] }
}

/** 判断路径是否严格位于指定目录内，阻止用户目录和符号链接越界写入。 */
function inside(root, target) {
  // 1、使用路径段判断，避免同名前缀目录被误判为子目录。
  const relative = path.relative(root, target)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/**
 * 生成三个确定性 PSD，返回与 local-psd.json.fixtures 相同的 { id, path, sha256 } 数组。
 * @param {string} outputDirectory 必须尚不存在，父目录必须存在；仅允许系统临时目录或仓库 temp 内。
 * @returns {Promise<Array<{id: string, path: string, sha256: string}>>} path 相对于 outputDirectory。
 */
export async function generatePsdFixtures(outputDirectory) {
  // 1、先规范真实父路径并检查写入范围；空值、已有目录及用户配置目录均直接拒绝。
  assert.ok(typeof outputDirectory === 'string' && outputDirectory.trim(), '必须明确指定新的素材输出目录')
  const requested = path.resolve(outputDirectory)
  const parent = await realpath(path.dirname(requested))
  const directory = path.join(parent, path.basename(requested))
  const allowedRoots = [await realpath(os.tmpdir()), path.join(await realpath(repository), 'temp')]
  assert.ok(allowedRoots.some((root) => inside(root, directory)), '素材只能写入系统临时目录或仓库 temp 内的新目录')
  // 2、每次从固定数据重建，写出前使用同一 ag-psd 再读回验证真实结构。
  initializeCanvas(createCanvas)
  const payloads = variants.map((variant) => {
    const children = characterLayers(variant)
    flatten(children).forEach(({ item }, index) => { item.id = index + 1 })
    const bytes = writePsdBuffer({ width: size, height: size, children, canvas: fixtureComposite(children) },
      { generateThumbnail: false, trimImageData: false, noBackground: true })
    verifyPsd(bytes, variant)
    return { id: `synthetic-${variant}`, bytes }
  })
  // 3、独占创建整个目录，并对每个 PSD 再使用 wx；失败时保留现场，绝不清空或覆盖旧目录。
  await mkdir(directory)
  const fixtures = []
  for (const { id, bytes } of payloads) {
    const filename = `${id}.psd`
    await writeFile(path.join(directory, filename), bytes, { flag: 'wx', mode: 0o600 })
    fixtures.push({ id, path: filename, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  return fixtures
}

/** 独立本地探针：两次真实生成验证确定性，并测试拒绝覆盖；不启动 Electron。 */
async function verifyGenerator() {
  // 1、只在新建的系统临时目录中运行，两次生成使用不同的输出子目录。
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-generated-psd-'))
  const directory = path.join(root, 'fixtures')
  const repeat = path.join(root, 'repeat')
  const fixtures = await generatePsdFixtures(directory)
  assert.deepEqual(await generatePsdFixtures(repeat), fixtures, '相同生成器产生了不同哈希')
  const evidence = []
  // 2、读取实际落盘文件，逐字节比较重复生成结果，再记录结构验证证据。
  for (const [index, fixture] of fixtures.entries()) {
    const bytes = await readFile(path.join(directory, fixture.path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256)
    assert.ok(bytes.equals(await readFile(path.join(repeat, fixture.path))), '两次 PSD 字节不同')
    evidence.push(verifyPsd(bytes, variants[index]))
  }
  // 3、再次写入相同目录必须报 EEXIST，旧素材哈希必须完全不变。
  await assert.rejects(generatePsdFixtures(directory), { code: 'EEXIST' })
  for (const fixture of fixtures) {
    const bytes = await readFile(path.join(directory, fixture.path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256)
  }
  console.log(JSON.stringify({ fixtureRoot: directory, manifest: { version: 1, fixtures },
    checks: { deterministicBytes: true, diskHashesVerified: true, refusesOverwrite: true, oldFilesUnchanged: true }, evidence }, null, 2))
}

/** 命令行入口仅输出素材清单或验证证据，清单文件由父测试按需另行独占创建。 */
async function main() {
  // 1、--verify 自行建立隔离探针目录；普通调用要求提供明确的新输出目录。
  const args = process.argv.slice(2)
  assert.equal(args.length, 1, '用法：node tests/fixtures/generate-psd.mjs <新的测试输出目录|--verify>')
  if (args[0] === '--verify') await verifyGenerator()
  else console.log(JSON.stringify({ version: 1, fixtures: await generatePsdFixtures(args[0]) }, null, 2))
}

// 1、被父测试导入时不自动生成文件，直接执行本文件时才启动命令行入口。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
