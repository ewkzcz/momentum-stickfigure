import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertImageBase64, assertTemplateImagePayload } from '../src/main/template-image-parameters.js'

 test('模板图片预算：解码前拒绝超限与非法编码，保留有无填充的合法数据', () => {
  assert.equal(assertImageBase64('aGVsbG8=', 5), 5)
  assert.equal(assertImageBase64('aGVsbG8', 5), 5)
  assert.throws(() => assertImageBase64('aGVsbG8=', 4), /容量/)
  for (const invalid of ['', '=', 'a', 'a===', 'aGVsbG8==', '%%%=', {}, null]) assert.throws(() => assertImageBase64(invalid), /参数/)
  assert.throws(() => assertTemplateImagePayload('cleanup', { templateType: 'actionTemplate', validTemplateIds: Array(10001).fill('a') }), /列表/)
})

const templateType = 'actionTemplate'
const image = 'data:image/png;base64,aGVsbG8='

test('模板图片参数：错误清理列表和批量载荷拒绝且已有图片保持不变', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const call = (name, payload) => desktop.page.evaluate(({ name, payload }) => window.electronAPI.invoke(`template-storage-${name}`, payload), { name, payload })
  try {
    const userData = await desktop.application.evaluate(({ app }) => app.getPath('userData'))
    const saved = await call('save-image', { templateType, templateId: 'keep', base64Data: image })
    assert.equal(saved.success, true)
    const cases = [
      ['cleanup', { templateType, validTemplateIds: 'other' }],
      ['cleanup', { templateType, validTemplateIds: [null] }],
      ['cleanup', { templateType }],
      ['batch-save', { templateType, imagePreviews: {} }],
      ['batch-save', { templateType, imagePreviews: [{ id: 'valid', base64_data: image }, null] }],
      ['batch-load', { filePathsData: 'bad' }],
      ['batch-delete', { filePathsData: [{ file_path: saved.filePath }, null] }],
      ['save-image', { templateType, templateId: 'keep', base64Data: 'data:image/png;base64,%%%=' }],
      ['load-image', { relativePath: {} }],
      ['delete-image', { relativePath: {} }],
      ['save-image', null]
    ]
    for (const [name, payload] of cases) {
      const result = await call(name, payload)
      assert.equal(result.success, false, `${name}必须明确拒绝非法参数`)
      assert.match(result.error, /参数|base64/i)
      assert.equal(await readFile(path.join(userData, saved.filePath), 'utf8'), 'hello')
    }
    assert.deepEqual(await call('cleanup', { templateType, validTemplateIds: ['keep'] }), { success: true, cleanCount: 0 })
    assert.deepEqual(await call('load-image', { relativePath: saved.filePath }), { success: true, base64Data: image })
    assert.deepEqual(await call('cleanup', { templateType, validTemplateIds: [] }), { success: true, cleanCount: 1 })
  } finally { await desktop.close() }
})
