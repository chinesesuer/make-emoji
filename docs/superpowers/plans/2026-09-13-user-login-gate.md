# 微信用户登录与功能门禁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为小程序建立统一微信用户登录能力，并在所有上传、生成、转换、保存及个人数据入口执行登录门禁，登录成功后自动继续原操作。

**Architecture:** 客户端由 `miniprogram/utils/auth.js` 独立管理缓存、微信会话、用户授权和并发登录；页面仅调用 `ensureLogin()`。云端由 `quickstartFunctions` 使用可信 `OPENID` 创建或更新 `users` 记录，个人中心读取同一份客户端用户状态。

**Tech Stack:** 微信小程序 JavaScript、微信云开发、`wx.getUserProfile`、`wx.login`、`wx.checkSession`、Node.js `node:test`

**Spec:** `docs/superpowers/specs/2026-09-13-user-login-gate-design.md`

## Global Constraints

- 浏览素材、切换 Tab 和查看工具列表无需登录。
- 登录检查必须发生在媒体选择、上传、生成、转换或保存开始之前。
- 用户取消授权或登录失败时不得执行原操作。
- 客户端缓存不能作为云端可信身份，云端身份只取自 `cloud.getWXContext().OPENID`。
- 普通用户登录缓存不得复用管理员的 `adminToken`。
- 登录成功后必须自动继续用户刚才点击的操作。
- 不引入新的第三方依赖。
- 保留工作区中与本功能无关的未提交修改。

---

### Task 1: 公共客户端登录服务

**Files:**
- Create: `miniprogram/utils/auth.js`
- Create: `tests/auth.test.js`

**Interfaces:**
- Consumes: 全局微信 API `wx.getStorageSync`、`wx.setStorageSync`、`wx.removeStorageSync`、`wx.checkSession`、`wx.getUserProfile`、`wx.login`、`wx.cloud.callFunction`、`wx.showToast`。
- Produces: `getCurrentUser(): object|null`、`isLoggedIn(): boolean`、`ensureLogin(): Promise<object|null>`、`requireLogin(action): Function`、`logout(): void`。

- [ ] **Step 1: 编写公共登录服务失败测试**

在 `tests/auth.test.js` 使用 `node:test`，每个测试前安装可记录调用次数的 `global.wx`，清理模块缓存后重新加载 `auth.js`。至少覆盖：有效缓存直接返回、不重复授权；`checkSession` 失败后重新授权；首次授权调用云函数并缓存用户；用户取消返回 `null` 且不调用云函数；两个并发 `ensureLogin()` 只触发一次授权；`requireLogin` 只在成功登录后执行原操作。

```js
test('并发登录复用同一个授权请求', async () => {
  const api = installWx({ cachedUser: null, profile: { nickName: '小明', avatarUrl: 'avatar' } });
  const auth = loadAuth();
  const [first, second] = await Promise.all([auth.ensureLogin(), auth.ensureLogin()]);
  assert.deepEqual(first, second);
  assert.equal(api.profileCalls, 1);
  assert.equal(api.cloudCalls, 1);
});

test('取消授权时不执行受保护操作', async () => {
  const api = installWx({ profileError: { errMsg: 'getUserProfile:fail cancel' } });
  const auth = loadAuth();
  let executed = false;
  await auth.requireLogin(async () => { executed = true; })();
  assert.equal(executed, false);
  assert.equal(api.cloudCalls, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/auth.test.js`

Expected: FAIL，错误指出无法加载 `../miniprogram/utils/auth`。

- [ ] **Step 3: 实现最小公共登录服务**

在 `miniprogram/utils/auth.js` 使用缓存键 `emojiUserSession`，将回调 API 包装为 Promise。`ensureLogin()` 先读取缓存并调用 `wx.checkSession`；有效则返回缓存用户，失效则清理缓存并进入微信授权登录流程。

```js
const USER_KEY = 'emojiUserSession';
let loginTask = null;

function getCurrentUser() {
  const value = wx.getStorageSync(USER_KEY);
  return value && value.openid ? value : null;
}

function checkSession() {
  return new Promise(resolve => wx.checkSession({ success: () => resolve(true), fail: () => resolve(false) }));
}

async function performLogin() {
  try {
    const profileResult = await new Promise((resolve, reject) => wx.getUserProfile({ desc: '用于登录并展示头像昵称', success: resolve, fail: reject }));
    await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }));
    const response = await wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: { type: 'login', profile: profileResult.userInfo || {} }
    });
    const user = response.result && response.result.user;
    if (!response.result || !response.result.success || !user || !user.openid) throw new Error('登录服务未返回用户信息');
    wx.setStorageSync(USER_KEY, user);
    return user;
  } catch (error) {
    const cancelled = /cancel|deny/i.test(String(error.errMsg || error.message));
    wx.showToast({ title: cancelled ? '登录后才能使用该功能' : '登录失败，请稍后重试', icon: 'none' });
    return null;
  }
}

async function ensureLogin() {
  const cached = getCurrentUser();
  if (cached && await checkSession()) return cached;
  if (cached) wx.removeStorageSync(USER_KEY);
  if (!loginTask) loginTask = performLogin().finally(() => { loginTask = null; });
  return loginTask;
}

function requireLogin(action) {
  return async function protectedAction(...args) {
    const user = await ensureLogin();
    if (!user) return undefined;
    return action.apply(this, args);
  };
}

function isLoggedIn() { return !!getCurrentUser(); }
function logout() { wx.removeStorageSync(USER_KEY); }

module.exports = { getCurrentUser, isLoggedIn, ensureLogin, requireLogin, logout };
```

- [ ] **Step 4: 运行公共登录服务测试**

Run: `node --test tests/auth.test.js`

Expected: PASS，所有缓存、取消、失败和并发用例通过。

- [ ] **Step 5: 提交客户端登录服务**

```bash
git add miniprogram/utils/auth.js tests/auth.test.js
git commit -m "新增微信用户登录服务"
```

---

### Task 2: 云端用户登录与资料持久化

**Files:**
- Create: `cloudfunctions/quickstartFunctions/user-login.js`
- Modify: `cloudfunctions/quickstartFunctions/index.js`
- Create: `tests/user-login-cloud.test.js`

**Interfaces:**
- Consumes: `db.collection('users')`、可信 `openid`、客户端 `profile`。
- Produces: `loginUser({ db, openid, profile, now }): Promise<{ success: true, user: object }>`；`quickstartFunctions` 的 `event.type === 'login'` 分支。

- [ ] **Step 1: 编写云端登录失败测试**

在 `tests/user-login-cloud.test.js` 使用内存集合替身覆盖首次创建、再次登录更新、昵称头像清洗、缺少 `openid` 抛错，以及返回用户的 `openid` 必须来自函数参数而不是 `profile.openid`。

```js
test('忽略客户端 openid 并创建可信用户', async () => {
  const db = createMemoryDb();
  const result = await loginUser({
    db,
    openid: 'trusted-openid',
    profile: { openid: 'forged-openid', nickName: '小明', avatarUrl: 'https://avatar' },
    now: new Date('2026-09-13T00:00:00Z')
  });
  assert.equal(result.user.openid, 'trusted-openid');
  assert.equal(db.records[0]._openid, 'trusted-openid');
});
```

- [ ] **Step 2: 运行云端登录测试确认失败**

Run: `node --test tests/user-login-cloud.test.js`

Expected: FAIL，错误指出 `user-login.js` 不存在。

- [ ] **Step 3: 实现可测试的云端用户模块**

`user-login.js` 导出 `loginUser` 和 `sanitizeProfile`。昵称最多保留 40 个字符，头像地址最多保留 1000 个字符，非字符串转为空字符串。按 `_openid` 查询；存在时更新，缺失时新增。

```js
function sanitizeText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sanitizeProfile(profile = {}) {
  return {
    nickName: sanitizeText(profile.nickName, 40) || '微信用户',
    avatarUrl: sanitizeText(profile.avatarUrl, 1000)
  };
}

async function loginUser({ db, openid, profile, now = new Date() }) {
  if (!openid) throw new Error('无法获取微信用户身份');
  const clean = sanitizeProfile(profile);
  const users = db.collection('users');
  const found = await users.where({ _openid: openid }).limit(1).get();
  const data = { ...clean, lastLoginAt: now };
  if (found.data && found.data[0]) await users.doc(found.data[0]._id).update({ data });
  else await users.add({ data: { _openid: openid, ...data, createdAt: now } });
  return { success: true, user: { openid, ...clean } };
}

module.exports = { loginUser, sanitizeProfile };
```

- [ ] **Step 4: 将登录事件接入云函数入口**

在 `quickstartFunctions/index.js` 引入 `loginUser`，并在 switch 中加入：

```js
case 'login': {
  const wxContext = cloud.getWXContext();
  return loginUser({ db, openid: wxContext.OPENID, profile: event.profile });
}
```

- [ ] **Step 5: 运行云端与客户端登录测试**

Run: `node --test tests/auth.test.js tests/user-login-cloud.test.js`

Expected: PASS。

- [ ] **Step 6: 提交云端登录接口**

```bash
git add cloudfunctions/quickstartFunctions/index.js cloudfunctions/quickstartFunctions/user-login.js tests/user-login-cloud.test.js
git commit -m "新增云端微信用户登录接口"
```

---

### Task 3: 首页与视频转 GIF 登录门禁

**Files:**
- Modify: `miniprogram/pages/index/index.js`
- Modify: `miniprogram/pages/gifVideo/gifVideo.js`
- Create: `tests/login-gates.test.js`

**Interfaces:**
- Consumes: `ensureLogin(): Promise<object|null>`。
- Produces: 首页生成/保存和视频选择/转换/保存的登录前置检查。

- [ ] **Step 1: 编写核心入口失败测试**

在 `tests/login-gates.test.js` 读取页面源码，断言两个页面引入 `../../utils/auth`，并且以下异步方法在第一个微信媒体、云函数或相册 API 之前出现 `await ensureLogin()` 与空值返回：`generateEmoji`、`saveGeneratedImage`、`chooseVideo`、`startConvert`、`saveGif`。

```js
test('首页生成和视频上传转换保存均先登录', () => {
  assertProtected('pages/index/index.js', ['generateEmoji', 'saveGeneratedImage']);
  assertProtected('pages/gifVideo/gifVideo.js', ['chooseVideo', 'startConvert', 'saveGif']);
});
```

- [ ] **Step 2: 运行核心入口测试确认失败**

Run: `node --test tests/login-gates.test.js`

Expected: FAIL，页面尚未引入或调用 `ensureLogin`。

- [ ] **Step 3: 接入首页门禁**

在首页顶部加入：

```js
const { ensureLogin } = require('../../utils/auth');
```

将 `generateEmoji` 和 `saveGeneratedImage` 改为异步，并在任何生成、保存状态变更前加入：

```js
const user = await ensureLogin();
if (!user) return;
```

- [ ] **Step 4: 接入视频转 GIF 门禁**

在视频页引入 `ensureLogin`。`chooseVideo` 已是异步函数，在 `wx.chooseMedia` 前检查登录；`startConvert` 在设置 `converting` 前检查登录；`saveGif` 改为异步并在 `wx.saveImageToPhotosAlbum` 前检查登录。`changeVideo` 继续调用 `chooseVideo` 或让用户点击选择入口，因此更换后的新上传仍经过门禁。

- [ ] **Step 5: 运行核心入口与全量测试**

Run: `node --test tests/login-gates.test.js tests/*.test.js`

Expected: PASS。

- [ ] **Step 6: 提交核心入口门禁**

```bash
git add miniprogram/pages/index/index.js miniprogram/pages/gifVideo/gifVideo.js tests/login-gates.test.js
git commit -m "限制登录后生成表情和转换视频"
```

---

### Task 4: 其余创作工具登录门禁

**Files:**
- Modify: `miniprogram/pages/gifImages/gifImages.js`
- Modify: `miniprogram/pages/gifText/gifText.js`
- Modify: `miniprogram/pages/emojiMixer/emojiMixer.js`
- Modify: `miniprogram/pages/diyEmoji/diyEmoji.js`
- Modify: `miniprogram/pages/gridSlice/gridSlice.js`
- Modify: `tests/login-gates.test.js`

**Interfaces:**
- Consumes: `ensureLogin(): Promise<object|null>`。
- Produces: 其余上传、生成与保存入口的一致门禁。

- [ ] **Step 1: 扩展失败测试覆盖所有入口**

扩展 `tests/login-gates.test.js`：

```js
test('所有创作工具在上传生成保存前登录', () => {
  assertProtected('pages/gifImages/gifImages.js', ['chooseImages', 'generateGif', 'saveGeneratedGif']);
  assertProtected('pages/gifText/gifText.js', ['chooseGif', 'generate', 'saveResult']);
  assertProtected('pages/emojiMixer/emojiMixer.js', ['saveEmoji']);
  assertProtected('pages/diyEmoji/diyEmoji.js', ['chooseMaterial', 'save']);
  assertProtected('pages/gridSlice/gridSlice.js', ['chooseImage', 'generateTiles', 'saveAll']);
});
```

- [ ] **Step 2: 运行测试确认新增用例失败**

Run: `node --test tests/login-gates.test.js`

Expected: FAIL，列出尚未接入的页面函数。

- [ ] **Step 3: 接入 GIF 工具门禁**

在 `gifImages.js` 与 `gifText.js` 引入 `ensureLogin`。将同步保存函数改为 `async`；每个约定入口首先执行：

```js
const user = await ensureLogin();
if (!user) return;
```

检查必须位于 `wx.chooseMedia`、上传、生成状态变更和 `wx.saveImageToPhotosAlbum` 之前。

- [ ] **Step 4: 接入更多工具门禁**

在 `emojiMixer.js`、`diyEmoji.js` 与 `gridSlice.js` 引入 `ensureLogin`。保护 `saveEmoji`、`chooseMaterial`、`save`、`chooseImage`、`generateTiles`、`saveAll`。同步的 `chooseMaterial`、`chooseImage` 改为 `async`，登录后继续使用原事件对象。

- [ ] **Step 5: 运行门禁与全量测试**

Run: `node --test tests/login-gates.test.js tests/*.test.js`

Expected: PASS，原有素材、TabBar 与 GIF 测试保持通过。

- [ ] **Step 6: 提交其余工具门禁**

```bash
git add miniprogram/pages/gifImages/gifImages.js miniprogram/pages/gifText/gifText.js miniprogram/pages/emojiMixer/emojiMixer.js miniprogram/pages/diyEmoji/diyEmoji.js miniprogram/pages/gridSlice/gridSlice.js tests/login-gates.test.js
git commit -m "为创作工具统一添加登录门禁"
```

---

### Task 5: 个人中心登录状态与入口保护

**Files:**
- Modify: `miniprogram/pages/profile/profile.js`
- Modify: `miniprogram/pages/profile/profile.wxml`
- Modify: `miniprogram/pages/profile/profile.wxss`
- Modify: `tests/login-gates.test.js`

**Interfaces:**
- Consumes: `getCurrentUser()`、`ensureLogin()`。
- Produces: `user`、`loggedIn` 页面状态，`login()` 和 `openUserFeature()` 事件处理函数。

- [ ] **Step 1: 编写个人中心失败测试**

增加断言：个人中心引入 `getCurrentUser` 与 `ensureLogin`；`onShow` 调用 `refreshUser`；用户卡片绑定 `login`；四个用户入口绑定 `openUserFeature`；WXML 使用 `user.avatarUrl`、`user.nickName`，未登录时显示“点击登录”，且不再包含硬编码的“用户27674544”和“UID: 27674544”。

```js
test('个人中心展示真实登录状态并保护用户入口', () => {
  const js = readPage('pages/profile/profile.js');
  const wxml = readPage('pages/profile/profile.wxml');
  assert.match(js, /getCurrentUser/);
  assert.match(js, /async login\(\)/);
  assert.match(js, /async openUserFeature\(e\)/);
  assert.match(wxml, /user\.nickName/);
  assert.doesNotMatch(wxml, /用户27674544|UID: 27674544/);
});
```

- [ ] **Step 2: 运行个人中心测试确认失败**

Run: `node --test tests/login-gates.test.js`

Expected: FAIL，个人中心仍显示假用户。

- [ ] **Step 3: 实现个人中心状态和事件**

`profile.js` 设置初始数据 `{ user: null, loggedIn: false }`，并实现：

```js
refreshUser() {
  const user = getCurrentUser();
  this.setData({ user, loggedIn: !!user });
},
async login() {
  const user = await ensureLogin();
  if (user) this.setData({ user, loggedIn: true });
},
async openUserFeature(e) {
  const user = await ensureLogin();
  if (!user) return;
  this.setData({ user, loggedIn: true });
  wx.showToast({ title: `${e.currentTarget.dataset.name}即将上线`, icon: 'none' });
}
```

在现有 `onShow` 内保留 TabBar 路由同步并追加 `this.refreshUser()`。

- [ ] **Step 4: 更新个人中心界面**

用户卡片绑定 `bindtap="login"`。登录后头像使用 `<image class="avatar-image" src="{{user.avatarUrl}}" mode="aspectFill"/>`，无头像时使用默认人物符号；昵称显示 `{{loggedIn ? user.nickName : '点击登录'}}`；辅助文案显示 `{{loggedIn ? '普通用户' : '登录后使用全部功能'}}`。四个用户入口增加 `data-name` 并绑定 `openUserFeature`。

- [ ] **Step 5: 运行个人中心与全量测试**

Run: `node --test tests/login-gates.test.js tests/*.test.js`

Expected: PASS。

- [ ] **Step 6: 提交个人中心改造**

```bash
git add miniprogram/pages/profile/profile.js miniprogram/pages/profile/profile.wxml miniprogram/pages/profile/profile.wxss tests/login-gates.test.js
git commit -m "在个人中心展示微信登录状态"
```

---

### Task 6: 最终验证与发布说明

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 前五项任务的客户端和云端实现。
- Produces: 可复现的部署与验收说明。

- [ ] **Step 1: 在 README 增加部署说明**

写明：重新上传部署 `quickstartFunctions` 并选择云端安装依赖；确认 `users` 集合可由云函数写入；开发者工具清除普通用户缓存键 `emojiUserSession` 后测试首次登录；管理员登录使用 `adminToken`，不受本改动影响。

- [ ] **Step 2: 运行完整自动化验证**

Run: `node --test tests/*.test.js`

Expected: 全部 PASS，0 failures。

- [ ] **Step 3: 运行语法与差异检查**

```bash
node --check miniprogram/utils/auth.js
node --check cloudfunctions/quickstartFunctions/user-login.js
node --check cloudfunctions/quickstartFunctions/index.js
node --check miniprogram/pages/index/index.js
node --check miniprogram/pages/gifVideo/gifVideo.js
node --check miniprogram/pages/gifImages/gifImages.js
node --check miniprogram/pages/gifText/gifText.js
node --check miniprogram/pages/emojiMixer/emojiMixer.js
node --check miniprogram/pages/diyEmoji/diyEmoji.js
node --check miniprogram/pages/gridSlice/gridSlice.js
node --check miniprogram/pages/profile/profile.js
git diff --check
```

Expected: 所有命令退出码为 0。

- [ ] **Step 4: 在微信开发者工具手工验收**

按顺序验证：清除缓存后点击首页生成并授权，确认自动继续生成；再次生成不重复授权；清除缓存后点击视频选择并取消，确认不打开选择器；再次点击并登录，确认自动打开选择器；登录后切换多图 GIF、GIF 文字、DIY、混合和九宫格功能不重复授权；个人中心显示微信头像昵称。

- [ ] **Step 5: 提交发布说明**

```bash
git add README.md
git commit -m "补充微信用户登录部署说明"
```
