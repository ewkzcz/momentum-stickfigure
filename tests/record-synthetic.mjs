/** 自制素材参考采集：只使用实际人物页输出建立修改前的蒙版、剪切及混合模式参考。 */
import { syntheticFixtures, checkPsdFixture, syntheticReferenceDirectory } from './helpers/reference.mjs'

// 1、每份公开素材单独执行同一业务场景，参考目录只允许首次创建。
for (const fixture of await syntheticFixtures()) await checkPsdFixture(fixture, true, syntheticReferenceDirectory)
