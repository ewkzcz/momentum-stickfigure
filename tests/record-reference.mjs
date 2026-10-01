/** 首次原版参考采集入口：只能显式执行，现有参考目录绝不覆盖。 */
import { fixtures, checkPsdFixture } from './helpers/reference.mjs'

// 1、逐素材运行实际业务场景，失败即终止，不留下完整验收标记。
for (const fixture of await fixtures()) await checkPsdFixture(fixture, true)
