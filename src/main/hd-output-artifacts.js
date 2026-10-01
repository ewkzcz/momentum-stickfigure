/** HD精确产物：主进程预定路径；准备/完成/发布各持媒体额度，Python期间不持有。 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { MEDIA_LIMITS, canonicalFile, snapshotInputInLease, validateArtifactInLease, publishArtifactInLease, grantMediaFilesInLease } from './local-media-authorization.js'
import { withMediaAdmission, runMediaOperation } from './media-resource-admission.js'

function alive(owner, signal) {
  if (owner.isDestroyed() || signal?.aborted) throw signal?.reason || new Error('任务窗口已关闭')
}
function segment(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\0]/.test(name)) throw new Error('产物文件名无效')
  return name
}
export function parseCompletion(stdout, expected) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 1024 * 1024) throw new Error('产物完成记录超过限制')
  const ids = Array.isArray(expected) ? expected : [expected]
  const records = stdout.split(/\r?\n/).filter(line => line.startsWith('MOMENTUM_ARTIFACT '))
  if (records.length !== ids.length || new Set(ids).size !== ids.length || records.some((line, index) => line !== `MOMENTUM_ARTIFACT ${ids[index]}`)) throw new Error('产物完成编号无效、缺失或重复')
}
export async function createArtifactTask(options) {
  let task
  try {
    return await withMediaAdmission({ owner: options.owner, signal: options.signal }, async lease => {
      task = await createArtifactTaskInLease(lease, options)
      return task
    })
  } catch (error) { if (task) task.cleanup(error); throw error }
}
export async function createArtifactTaskInLease(lease, { owner, temporaryRoot, inputs, signal }) {
  let directory, canonicalDirectory
  const taskId = randomUUID(), records = [], published = []
  let inputBytes = 0, inputPixels = 0, outputBytes = 0, outputPixels = 0, committed = false, publishing = false
  const cleanup = cause => {
    const errors = cause ? [cause] : []
    if (!committed) {
      for (const file of published) {
        try { file.rollback?.() } catch (error) { errors.push(error) }
        try {
          const stat = fs.lstatSync(file.path)
          if (!stat.isSymbolicLink() && stat.dev === file.dev && stat.ino === file.ino) fs.unlinkSync(file.path)
        } catch (error) { if (error.code !== 'ENOENT') errors.push(error) }
      }
      if (directory) try { fs.rmSync(directory, { recursive: true, force: true }) } catch (error) { errors.push(error) }
    }
    if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'HD任务失败且文件清理失败')
  }
  let manifest
  try {
    await runMediaOperation(lease, context => {
      context.check(); alive(owner, signal)
      if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MEDIA_LIMITS.files) throw new Error('任务输入数量无效')
      canonicalFile(temporaryRoot)
      directory = fs.mkdtempSync(path.join(temporaryRoot, 'momentum-hd-'))
      canonicalDirectory = canonicalFile(directory)
      fs.chmodSync(directory, 0o700)
    })
    for (const [index, file] of inputs.entries()) {
      const name = segment(path.basename(file))
      const snapshot = await snapshotInputInLease(lease, owner, file, directory, canonicalDirectory, index, { bytes: MEDIA_LIMITS.batchBytes - inputBytes, pixels: MEDIA_LIMITS.batchPixels - inputPixels })
      inputBytes += snapshot.size; inputPixels += snapshot.pixels
      records.push({ id: `${taskId}:${index}`, name, source: file, ...snapshot, completed: false })
    }
    await runMediaOperation(lease, context => {
      context.check(); alive(owner, signal)
      manifest = path.join(directory, 'images.json')
      fs.writeFileSync(manifest, JSON.stringify(records.filter(record => record.image).map(({ input, output, id }) => ({ input, output, id }))), { flag: 'wx', mode: 0o600 })
    })
  } catch (error) { cleanup(error) }
  return {
    directory, records, manifest,
    async complete(record, stdout) {
      return withMediaAdmission({ owner, signal }, async stage => {
        alive(owner, signal)
        if (!records.includes(record) || record.completed || record.completing || record.output !== path.join(directory, `output-${records.indexOf(record)}${path.extname(record.input)}`)) throw new Error('不属于本任务、路径越界或重复完成的产物')
        record.completing = true
        if (record.image) parseCompletion(stdout, record.id)
        const checked = await validateArtifactInLease(stage, owner, record, canonicalDirectory, { bytes: MEDIA_LIMITS.batchBytes - outputBytes, pixels: MEDIA_LIMITS.batchPixels - outputPixels })
        alive(owner, signal)
        outputBytes += checked.size; outputPixels += checked.pixels
        record.completed = true; record.identity = checked.identity
      })
    },
    async publish(outputDirectory) {
      // 一个发布事务一个额度；每项源字节消费结束后才串行登记目标授权，绝不嵌套排队。
      return withMediaAdmission({ owner, signal }, async stage => {
        alive(owner, signal)
        if (publishing || records.some(record => !record.completed)) throw new Error('任务重复发布或产物尚未全部验证')
        publishing = true
        for (const record of records) {
          const target = await publishArtifactInLease(stage, owner, record, canonicalDirectory, outputDirectory, published)
          if (record.image) {
            const grant = await grantMediaFilesInLease(stage, owner, [target])
            published[published.length - 1].rollback = grant.rollback
          }
          alive(owner, signal)
        }
        return published.map(file => file.path)
      })
    },
    commit() {
      alive(owner, signal)
      if (!publishing || published.length !== records.length) throw new Error('产物尚未全部发布')
      fs.rmSync(directory, { recursive: true, force: true })
      alive(owner, signal)
      committed = true
    },
    cleanup
  }
}
