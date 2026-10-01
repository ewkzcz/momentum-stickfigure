import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// 执行实际 bootstrap 的 open 包装段，不复制其判断实现，也不启动业务或触及用户文件。
const bootstrap = fs.readFileSync(new URL('./helpers/electron-bootstrap.cjs', import.meta.url), 'utf8')
const start = bootstrap.indexOf("for (const name of ['open', 'openSync', 'createWriteStream']) {")
const end = bootstrap.indexOf('syncBuiltinESMExports()', start)
assert.ok(start >= 0 && end > start, '必须执行真实启动器中的完整 open 保护段')
function boundary() {
  const checked = [], opened = []
  const fakeFs = { constants: fs.constants }
  for (const name of ['open', 'openSync', 'createWriteStream']) {
    fakeFs[name] = (...args) => { opened.push({ name, args }); return 42 }
  }
  vm.runInNewContext(bootstrap.slice(start, end), {
    fs: fakeFs,
    assertWritable: target => { checked.push(target); if (target === '/outside/sentinel') throw new Error('outside blocked') }
  })
  return { fs: fakeFs, checked, opened }
}

test('后台文件隔离：数字严格只读 flags 不得被误判为写入', () => {
  for (const name of ['open', 'openSync']) {
    for (const flags of [fs.constants.O_RDONLY, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK]) {
      const wrapped = boundary()
      assert.equal(wrapped.fs[name]('/outside/sentinel', flags), 42)
      assert.deepEqual(wrapped.checked, [])
      assert.equal(wrapped.opened.length, 1)
    }
  }
})

test('后台文件隔离：写入能力、修改位及未知数字 flags 仍须拒绝越界', () => {
  const c = fs.constants
  for (const name of ['open', 'openSync']) {
    for (const flags of [c.O_WRONLY, c.O_RDWR, c.O_CREAT, c.O_TRUNC, c.O_APPEND, c.O_EXCL,
      c.O_RDWR | c.O_NOFOLLOW | c.O_NONBLOCK, 0x40000000, -1, NaN, Infinity, 0.5,
      'w', 'a', 'r+', 'wx', 'ax+', 'w+']) {
      const wrapped = boundary()
      assert.throws(() => wrapped.fs[name]('/outside/sentinel', flags), /outside blocked/)
      assert.deepEqual(wrapped.checked, ['/outside/sentinel'])
      assert.equal(wrapped.opened.length, 0)
    }
  }
  const wrapped = boundary()
  assert.throws(() => wrapped.fs.createWriteStream('/outside/sentinel', { flags: 'r' }), /outside blocked/)
  assert.equal(wrapped.opened.length, 0)
})

test('后台文件隔离：隔离目录内写入保留参数及返回契约', () => {
  for (const name of ['open', 'openSync', 'createWriteStream']) {
    const wrapped = boundary()
    assert.equal(wrapped.fs[name]('/inside/output', fs.constants.O_WRONLY, 0o600), 42)
    assert.deepEqual(wrapped.checked, ['/inside/output'])
    assert.deepEqual(wrapped.opened, [{ name, args: ['/inside/output', fs.constants.O_WRONLY, 0o600] }])
  }
})
