# 我的制作云端作品库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页生成的表情自动保存到当前微信用户的云端作品库，相同内容只保留最新一条，并可从个人中心查看。

**Architecture:** 客户端把画布视觉状态规范化并计算稳定指纹，生成成功后上传成品并调用 `quickstartFunctions` 保存元数据。云端只使用可信 OPENID，以 OPENID 与指纹的哈希作为确定性记录 ID 完成去重；“我的制作”页面读取最近 50 条记录并批量换取临时地址后预览。

**Tech Stack:** 微信小程序 JavaScript、微信云开发数据库与云存储、Node.js `crypto`、`node:test`

**Spec:** `docs/superpowers/specs/2026-09-13-my-creations-design.md`

## Global Constraints

- 登录取消时不得生成、上传、保存记录或跳转到作品页。
- 云端身份只取 `cloud.getWXContext().OPENID`，不得信任客户端身份字段。
- 生成图片成功后即展示结果；作品归档失败不得清除本地生成结果。
- 同一用户、相同画布视觉内容只保留一条记录，并更新为最新图片和时间。
- 不同用户的作品必须隔离。
- “我的制作”最多返回最近更新的 50 条，按 `updatedAt` 倒序。
- 不增加第三方依赖，不改管理员 `adminToken`，保留无关工作区修改。

---

### Task 1: 稳定的作品内容指纹

**Files:**
- Create: `miniprogram/utils/creation-fingerprint.js`
- Create: `tests/creation-fingerprint.test.js`

**Interfaces:**
- Consumes: 首页当前画布数据对象。
- Produces: `buildComposition(data): object`、`fingerprintComposition(composition): string`、`buildCreationFingerprint(data): string`。

- [ ] **Step 1: 编写失败测试**

测试相同视觉字段在对象键顺序不同、生成时间和本地临时路径不同时得到相同的 16 位十六进制指纹；身体素材、文字、位置、缩放、旋转、颜色或输出设置任一变化会改变指纹。

```js
test('非视觉临时状态不影响作品指纹', () => {
  const base = { bodyFileUrl: 'cloud://body', bodyPosition: { x: 50, y: 50 }, bodyTransform: { scale: 1, rotate: 0, flip: false }, generatedImage: '/tmp/a.png', generating: true };
  assert.equal(buildCreationFingerprint(base), buildCreationFingerprint({ ...base, generatedImage: '/tmp/b.png', generating: false }));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/creation-fingerprint.test.js`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现规范化与稳定哈希**

`buildComposition` 只挑选身体、表情、挂件、文字及导出视觉字段；缺失值填入稳定默认值。递归按键名排序后 JSON 序列化，使用两个不同初值的 FNV-1a 32 位结果拼成 16 位十六进制字符串。

```js
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableValue(value[key]);
    return out;
  }, {});
  return value;
}
```

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/creation-fingerprint.test.js tests/*.test.js`

```bash
git add miniprogram/utils/creation-fingerprint.js tests/creation-fingerprint.test.js
git commit -m "新增表情作品内容指纹"
```

---

### Task 2: 云端作品保存与列表接口

**Files:**
- Create: `cloudfunctions/quickstartFunctions/creation-service.js`
- Modify: `cloudfunctions/quickstartFunctions/index.js`
- Create: `tests/creation-cloud.test.js`

**Interfaces:**
- Consumes: `saveCreation({ db, openid, fingerprint, fileID, fileType, now, deleteFiles })`、`listCreations({ db, openid, limit })`。
- Produces: `event.type === 'saveCreation'` 与 `event.type === 'listCreations'` 云函数分支。

- [ ] **Step 1: 编写云端失败测试**

使用内存数据库替身覆盖：首次保存；相同用户与指纹更新原记录且保留 `createdAt`；替换后删除旧文件；删除失败不回滚；不同用户隔离；非法字段拒绝；集合不存在时自动创建；列表按更新时间倒序限制 50 条。

```js
test('相同内容更新原记录而不新增', async () => {
  const db = createDatabase();
  await saveCreation({ db, openid: 'u1', fingerprint: '0123456789abcdef', fileID: 'cloud://old.png', fileType: 'png', now: oldDate, deleteFiles });
  await saveCreation({ db, openid: 'u1', fingerprint: '0123456789abcdef', fileID: 'cloud://new.png', fileType: 'png', now: newDate, deleteFiles });
  assert.equal(db.records.length, 1);
  assert.equal(db.records[0].fileID, 'cloud://new.png');
  assert.equal(db.records[0].createdAt, oldDate);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/creation-cloud.test.js`

Expected: FAIL，`creation-service.js` 不存在。

- [ ] **Step 3: 实现云端服务**

使用 `crypto.createHash('sha256').update(`${openid}:${fingerprint}`).digest('hex')` 生成记录 ID。校验指纹为 16 位十六进制、`fileID` 为非空云文件 ID、`fileType` 仅为 `png|jpg`。通过 `collection.doc(recordID).get()` 判断新增或更新；集合缺失时调用 `db.createCollection('creations')` 后重试。更新成功后异步容错删除旧文件。

`listCreations` 固定将 limit 夹在 1 到 50，查询 `_openid`，按 `updatedAt desc` 排序，并只映射公开作品字段。

- [ ] **Step 4: 接入可信云函数入口**

在 `index.js` 引入服务，并加入：

```js
case 'saveCreation': {
  const openid = cloud.getWXContext().OPENID;
  return saveCreation({ db, openid, ...event.creation, deleteFiles: fileList => cloud.deleteFile({ fileList }) });
}
case 'listCreations': {
  const openid = cloud.getWXContext().OPENID;
  return listCreations({ db, openid, limit: 50 });
}
```

测试必须执行真实 `exports.main` 并证明伪造的 `event.openid` 无效。

- [ ] **Step 5: 运行测试并提交**

Run: `node --test tests/creation-cloud.test.js tests/user-login-cloud.test.js tests/*.test.js`

```bash
git add cloudfunctions/quickstartFunctions/creation-service.js cloudfunctions/quickstartFunctions/index.js tests/creation-cloud.test.js
git commit -m "新增云端表情作品库接口"
```

---

### Task 3: 首页生成后自动归档

**Files:**
- Modify: `miniprogram/pages/index/index.js`
- Create: `tests/creation-save-flow.test.js`

**Interfaces:**
- Consumes: `buildCreationFingerprint(data): string`、`wx.cloud.uploadFile`、`quickstartFunctions:saveCreation`。
- Produces: `archiveGeneratedCreation(tempFilePath, fileType): Promise<boolean>`，由 `generateEmoji()` 在展示结果后调用。

- [ ] **Step 1: 编写保存流程失败测试**

用 Page、canvas、wx 云 API 替身真实执行生成流程，覆盖：登录成功后生成、先显示本地结果、上传到 `user-creations/<openid>/`、调用 `saveCreation`；记录失败时本地结果仍存在且删除刚上传文件；重复点击仍受生成锁保护；登录取消不上传。

```js
test('生成成功后展示结果并自动归档', async () => {
  await page.generateEmoji();
  assert.equal(page.data.resultVisible, true);
  assert.equal(calls.upload.length, 1);
  assert.equal(calls.cloud.at(-1).data.type, 'saveCreation');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/creation-save-flow.test.js`

Expected: FAIL，没有上传与 `saveCreation` 调用。

- [ ] **Step 3: 实现自动归档**

首页引入指纹工具。`generateEmoji()` 从 `ensureLogin()` 返回值保留可信响应中的用户信息；画布导出并 `setData({ generatedImage, resultVisible: true })` 后调用 `archiveGeneratedCreation`。上传路径使用经过 `/[^a-zA-Z0-9_-]/g` 清洗的缓存 openid、指纹、时间和实际扩展名。

归档失败时若已取得新 `fileID`，调用 `wx.cloud.deleteFile` 清理；捕获错误并提示“作品保存失败，请稍后重试”，但不进入外层生成失败分支。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/creation-save-flow.test.js tests/login-gates.test.js tests/*.test.js`

```bash
git add miniprogram/pages/index/index.js tests/creation-save-flow.test.js
git commit -m "生成表情后自动保存到作品库"
```

---

### Task 4: 我的制作页面与个人中心入口

**Files:**
- Create: `miniprogram/pages/myCreations/myCreations.js`
- Create: `miniprogram/pages/myCreations/myCreations.json`
- Create: `miniprogram/pages/myCreations/myCreations.wxml`
- Create: `miniprogram/pages/myCreations/myCreations.wxss`
- Modify: `miniprogram/pages/profile/profile.js`
- Modify: `miniprogram/pages/profile/profile.wxml`
- Modify: `miniprogram/app.json`
- Create: `tests/my-creations-page.test.js`
- Modify: `tests/login-gates.test.js`

**Interfaces:**
- Consumes: `ensureLogin()`、`quickstartFunctions:listCreations`、`wx.cloud.getTempFileURL`。
- Produces: `loadCreations(): Promise<void>`、`retryLoad()`、`previewCreation(e)`。

- [ ] **Step 1: 编写页面与导航失败测试**

执行个人中心 `openUserFeature`：`data-action="creations"` 登录成功后调用 `wx.navigateTo({ url: '/pages/myCreations/myCreations' })`，取消时不跳转；其他入口继续显示占位提示。执行作品页加载，验证 loading、空状态、错误状态、重试、批量临时地址转换以及预览参数。

```js
test('点击我的制作登录后进入作品页', async () => {
  await profile.openUserFeature({ currentTarget: { dataset: { action: 'creations', name: '我的制作' } } });
  assert.deepEqual(navigations, ['/pages/myCreations/myCreations']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/my-creations-page.test.js tests/login-gates.test.js`

Expected: FAIL，页面与导航分支尚不存在。

- [ ] **Step 3: 实现作品页面**

页面数据使用 `{ creations: [], loading: false, error: '' }`。`onShow` 调用 `loadCreations`；先 `ensureLogin`，成功后调用列表接口，把有效 fileID 每 50 个一批传给 `wx.cloud.getTempFileURL`，映射 `tempFileURL`。空列表展示“还没有作品，去制作一个吧”；失败展示“加载失败，点击重试”。

`previewCreation` 从 `data-url` 读取当前地址，并以全部有效临时地址作为 `urls` 调用 `wx.previewImage`。

- [ ] **Step 4: 实现入口与页面注册**

在 `profile.wxml` 的“我的制作”增加 `data-action="creations"`。`openUserFeature` 登录成功后若 action 为 `creations` 则导航并返回，其余入口维持“即将上线”。在 `app.json` pages 数组加入 `pages/myCreations/myCreations`。

- [ ] **Step 5: 实现与现有页面一致的界面**

使用现有紫色标题栏、浅灰背景和白色圆角卡片风格；作品以三列方形网格展示，图片 `mode="aspectFill"`，页面覆盖加载、空、错误与内容四种状态。页面不复制底部 TabBar，因为它是个人中心下钻页。

- [ ] **Step 6: 运行测试并提交**

Run: `node --test tests/my-creations-page.test.js tests/login-gates.test.js tests/*.test.js`

```bash
git add miniprogram/pages/myCreations miniprogram/pages/profile/profile.js miniprogram/pages/profile/profile.wxml miniprogram/app.json tests/my-creations-page.test.js tests/login-gates.test.js
git commit -m "新增我的制作作品查看页面"
```

---

### Task 5: 部署说明与最终验证

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 前四项完整功能。
- Produces: 可复现部署步骤和验收清单。

- [ ] **Step 1: 补充部署说明**

记录重新部署 `quickstartFunctions`、`creations` 自动建表、建议索引、云存储权限，以及清除 `emojiUserSession` 后的登录验收步骤。

- [ ] **Step 2: 运行自动化验证**

Run: `node --test tests/*.test.js`

Expected: 所有测试通过，0 failures。

- [ ] **Step 3: 运行语法与差异检查**

```powershell
$files = @(
  'miniprogram/utils/creation-fingerprint.js',
  'cloudfunctions/quickstartFunctions/creation-service.js',
  'cloudfunctions/quickstartFunctions/index.js',
  'miniprogram/pages/index/index.js',
  'miniprogram/pages/profile/profile.js',
  'miniprogram/pages/myCreations/myCreations.js'
)
foreach ($file in $files) { node --check $file }
git diff --check
```

- [ ] **Step 4: 手工验收**

依次验证：首次生成后作品出现；相同配置再次生成仍为一条且更新时间变化；改变素材或文字后新增；切换微信用户看不到前一用户作品；点击作品打开大图；模拟归档失败时生成结果仍可保存到相册。

- [ ] **Step 5: 提交说明**

```bash
git add README.md
git commit -m "补充我的制作部署说明"
```
