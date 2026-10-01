import test from "node:test";
import assert from "node:assert/strict";
import { effectScope, shallowRef, ref } from "vue";
import {
  modules,
  setup as renderSetup,
  flush,
} from "./helpers/render-race-fixture.mjs";
function setup(t) {
  renderSetup(t);
  let stored = { storage_version: "2.0.0", psdItems: [] };
  const writes = [],
    digests = [],
    previews = [];
  const originalDigest = globalThis.crypto.subtle.digest.bind(
    globalThis.crypto.subtle,
  );
  t.mock.method(
    globalThis.crypto.subtle,
    "digest",
    (...args) =>
      new Promise((resolve) =>
        digests.push(async () => resolve(await originalDigest(...args))),
      ),
  );
  for (const [name, value] of Object.entries({
    localStorage: {
      getItem: () => JSON.stringify(stored),
      setItem: (k, v) => writes.push([k, v]),
      removeItem() {},
    },
    window: {
      electronAPI: {
        invoke: () => new Promise((resolve) => previews.push(resolve)),
      },
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, name, previous)
        : delete globalThis[name],
    );
  }
  const a = { id: "A", name: "A", filePath: "new-A" },
    b = { id: "B", name: "B", filePath: "B" };
  const currentPsdFile = shallowRef(a),
    currentPsdData = shallowRef({ width: 2, height: 2, layerHierarchy: [] });
  const scope = effectScope(),
    module = scope.run(() =>
      modules.usePresetData({
        currentPsdFile,
        currentPsdData,
        canvasRef: shallowRef(null),
        canvasWidth: ref(2),
        canvasHeight: ref(2),
      }),
    );
  t.after(() => scope.stop());
  return {
    a,
    b,
    module,
    scope,
    currentPsdFile,
    currentPsdData,
    writes,
    digests,
    previews,
    storedHash: async () =>
      Buffer.from(
        await originalDigest(
          "SHA-256",
          new globalThis.TextEncoder().encode(
            JSON.stringify({
              width: 2,
              height: 2,
              layerCount: 0,
              layerStructure: "[]",
            }),
          ),
        ),
      ).toString("hex"),
    setStored: (value) => {
      stored = value;
    },
  };
}
for (const mode of ["roundtrip", "unmount", "newer-load"])
  test(`预设哈希等待${mode}：旧无匹配结果不能清空新选择`, async (t) => {
    const f = setup(t),
      old = f.module.loadPresets();
    await flush();
    assert.equal(f.digests.length, 1);
    if (mode === "roundtrip") {
      f.currentPsdFile.value = f.b;
      f.currentPsdFile.value = f.a;
    }
    if (mode === "unmount") f.scope.stop();
    if (mode === "newer-load") {
      f.setStored({
        storage_version: "2.0.0",
        psdItems: [{ psdPath: "new-A", presets: [{ id: "new" }] }],
      });
      await f.module.loadPresets();
    } else f.module.presets.value = [{ id: "new" }];
    f.module.selectedPresetId.value = "new";
    await f.digests[0]();
    await old;
    assert.deepEqual(
      f.module.presets.value.map((p) => p.id),
      ["new"],
    );
    assert.equal(f.module.selectedPresetId.value, "new");
  });
test("旧预览补载结束不能在新会话启动路径保存", async (t) => {
  const f = setup(t);
  // 匹配记录包含旧版本已标记的路径更新字段，真实读取预览等待后会进入自动保存。
  f.setStored({
    storage_version: "2.0.0",
    psdItems: [
      {
        psdPath: "new-A",
        pathUpdated: true,
        presets: [{ id: "old", previewPath: "old.png" }],
      },
    ],
  });
  const old = f.module.loadPresets();
  await flush();
  assert.equal(f.previews.length, 1);
  f.currentPsdFile.value = f.b;
  f.module.presets.value = [{ id: "new" }];
  f.module.selectedPresetId.value = "new";
  f.previews[0]({ success: true, base64Data: "data:image/png;base64,AA==" });
  await flush();
  const lateDigests = f.digests.length;
  for (const release of f.digests) await release();
  await old;
  assert.equal(lateDigests, 0, "旧预览结束后不得开始保存当前B的哈希");
  assert.equal(f.writes.length, 0);
  assert.equal(f.module.selectedPresetId.value, "new");
});
test("自动路径保存哈希等待中切换：不得把新列表写进旧路径", async (t) => {
  const f = setup(t);
  f.setStored({
    storage_version: "2.0.0",
    psdItems: [
      {
        psdPath: "new-A",
        pathUpdated: true,
        presets: [{ id: "old", previewPath: "old.png" }],
      },
    ],
  });
  const work = f.module.loadPresets();
  await flush();
  f.previews[0]({ success: true, base64Data: "image" });
  await flush();
  assert.equal(f.digests.length, 1);
  f.currentPsdFile.value = f.b;
  f.module.presets.value = [{ id: "B-new", previewPath: "b.png" }];
  await f.digests[0]();
  await work;
  assert.equal(f.writes.length, 0);
});

for (const mode of ["switch", "normal"])
  test(`真实哈希匹配移动路径后${mode}：自动保存保持会话归属`, async (t) => {
    const f = setup(t),
      hash = await f.storedHash();
    f.setStored({
      storage_version: "2.0.0",
      psdItems: [
        {
          psdPath: "old-A",
          psdHash: hash,
          presets: [{ id: "moved", previewPath: "moved.png" }],
        },
      ],
    });
    const work = f.module.loadPresets();
    await flush();
    await f.digests[0]();
    await flush();
    assert.equal(f.previews.length, 1);
    f.previews[0]({ success: true, base64Data: "image" });
    await flush();
    assert.equal(f.digests.length, 2);
    if (mode === "switch") {
      f.currentPsdFile.value = f.b;
      f.module.presets.value = [{ id: "B-new", previewPath: "b.png" }];
    }
    await f.digests[1]();
    await work;
    if (mode === "switch") assert.equal(f.writes.length, 0);
    else {
      assert.equal(f.writes.length, 1);
      const data = JSON.parse(f.writes[0][1]);
      assert.equal(data.psdItems.length, 1);
      assert.equal(data.psdItems[0].psdPath, "new-A");
      assert.equal(data.psdItems[0].psdHash, hash);
      assert.deepEqual(data.psdItems[0].presets, [
        { id: "moved", previewPath: "moved.png" },
      ]);
    }
  });
for (const mode of ["switch", "normal"])
  test(`旧格式迁移图片保存等待${mode}：保护全局元数据提交`, async (t) => {
    const f = setup(t);
    f.setStored({
      psdItems: [
        { psdPath: "new-A", presets: [{ id: "legacy", base64Image: "image" }] },
      ],
    });
    const work = f.module.loadPresets();
    await flush();
    assert.equal(f.previews.length, 1);
    if (mode === "switch") {
      f.currentPsdFile.value = f.b;
      f.module.presets.value = [{ id: "new" }];
      f.module.selectedPresetId.value = "new";
    }
    f.previews[0]({ success: true, filePath: "legacy.png" });
    await flush();
    if (mode === "normal") {
      assert.equal(f.previews.length, 2);
      f.previews[1]({ success: true, base64Data: "image" });
    }
    await work;
    if (mode === "switch") {
      assert.equal(f.writes.length, 0);
      assert.equal(f.module.selectedPresetId.value, "new");
    } else {
      assert.equal(f.writes.length, 1);
      assert.equal(JSON.parse(f.writes[0][1]).storage_version, "2.0.0");
      assert.equal(f.module.presets.value[0].previewPath, "legacy.png");
    }
  });
test("旧存储结果迟到异常不能清空新会话选择", async (t) => {
  const f = setup(t);
  f.setStored({ storage_version: "2.0.0", psdItems: null });
  const work = f.module.loadPresets();
  f.currentPsdFile.value = f.b;
  f.module.presets.value = [{ id: "new" }];
  f.module.selectedPresetId.value = "new";
  await work;
  assert.deepEqual(
    f.module.presets.value.map((p) => p.id),
    ["new"],
  );
  assert.equal(f.module.selectedPresetId.value, "new");
});
test("自动保存预览等待中切换：旧对象及元数据都不得回填", async (t) => {
  const f = setup(t);
  f.setStored({
    storage_version: "2.0.0",
    psdItems: [
      {
        psdPath: "new-A",
        pathUpdated: true,
        presets: [{ id: "old", base64Image: "image" }],
      },
    ],
  });
  const work = f.module.loadPresets();
  await flush();
  await f.digests[0]();
  await flush();
  assert.equal(f.previews.length, 1);
  const oldPreset = f.module.presets.value[0];
  f.currentPsdFile.value = f.b;
  f.module.presets.value = [{ id: "new" }];
  f.previews[0]({ success: true, filePath: "old.png" });
  await work;
  assert.equal(oldPreset.previewPath, undefined);
  assert.equal(f.writes.length, 0);
});
test("正常路径加载保留预览补载与选择清空语义", async (t) => {
  const f = setup(t);
  f.setStored({
    storage_version: "2.0.0",
    psdItems: [
      { psdPath: "new-A", presets: [{ id: "ok", previewPath: "ok.png" }] },
    ],
  });
  f.module.selectedPresetId.value = "before";
  const work = f.module.loadPresets();
  await flush();
  f.previews[0]({ success: true, base64Data: "image" });
  await work;
  assert.equal(f.module.presets.value[0].base64Image, "image");
  assert.equal(f.module.selectedPresetId.value, null);
  assert.equal(f.writes.length, 0);
});
