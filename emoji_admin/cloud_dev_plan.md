# 表情包小程序 · 微信云开发落地方案

> 结论：**可以做，MVP 阶段强烈推荐云开发**。但 GIF 重计算、管理后台、搜索三块需要额外设计。

---

## 一、能不能做：逐项评估

| 能力 | 云开发支持度 | 说明 |
|---|---|---|
| 素材（身体/表情/挂件）存储与下发 | ✅ 完美 | 云存储自带 CDN，天然适合 |
| 表情仓库（几千条 + 分页） | ✅ 可以 | 文档型数据库，注意单次读取条数限制 |
| 用户作品保存 / 我的制作 | ✅ 完美 | 自带 `_openid`；**仅本人可见，不投稿、不公开** |
| 制作页本地合成（贴纸叠加） | ✅ 可以 | 纯前端 canvas，与后端无关 |
| **管理后台上传素材** | ⚠️ 需另建 | 云开发**没有自带后台 UI**，需 CMS 或自建 |
| **视频转GIF / GIF变速 / 裁剪** | ❌ 云函数做不了 | 需要 ffmpeg，云函数默认环境没有 |
| 表情搜索 | ⚠️ 弱 | 无全文索引，只能 `db.RegExp` 前缀匹配 |
| 内容安全审核 | ➖ **本产品不需要** | 无用户投稿，作品仅存本地相册，无公开 UGC |

**一句话判断**：除了「GIF 重计算」和「后台 UI」，其他云开发都能扛，而且比自建后端快 3-5 倍。

> **已确认无用户投稿**：审核流、`security.imgSecCheck`、举报机制一律不需要，后端直接少掉一个大模块。
> 若未来开放「分享作品到表情仓库」，再补内容安全 + 审核队列即可（见文末补充方案）。

---

## 二、推荐架构：云开发为主 + 云托管补重度计算

```
┌─────────────── 微信小程序（微信开发者工具） ───────────────┐
│  制作页（canvas 合成）· GIF工具 · 表情仓库 · 更多工具 · 我的 │
└───────┬──────────────────────────┬───────────────────────┘
        │ 读素材/仓库/作品           │ 上传（直传云存储）
        ▼                          ▼
┌────────────────────────────────────────────────────────┐
│                    微信云开发环境                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ 云数据库  │  │  云存储   │  │  云函数   │              │
│  │ 8个集合   │  │ 素材/作品 │  │ Node.js  │              │
│  └──────────┘  └──────────┘  └────┬─────┘              │
│                                    │ 轻量处理（多图转GIF/加文字）
│  ┌──────────────────────────────┐  │                    │
│  │ 云托管 CloudBase Run（Docker）│◄─┘ 重量处理             │
│  │ ffmpeg 容器：视频转GIF/变速/裁剪│                       │
│  └──────────────────────────────┘                       │
└────────────────────────────────────────────────────────┘
        ▲ 素材上传 / 上下架 / 排序
        │
┌───────┴────────┐
│  管理后台（三选一）│
│ A.云开发CMS      │ ← 零代码，推荐先上
│ B.自建Vue后台    │ ← 静态托管部署，可控性最高
│ C.控制台手动改   │ ← 仅调试期
└────────────────┘
```

---

## 三、数据库改造：MySQL 表 → 云开发集合

云开发数据库是 **MongoDB 文档型**，不是关系型：**没有 JOIN、没有外键、没有事务（有弱事务）**。
所以原 SQL 需要做三处改造：① 冗余字段替代联表 ② 嵌套对象替代中间表 ③ 数组字段替代标签表。

### 集合 1：`material_categories` 素材分类
```json
{
  "_id": "cat_panda",
  "scene": "body",              // body | face | accessory
  "name": "熊猫",
  "cover": "cloud://env.xxx/cat/panda.png",
  "sort": 1,
  "status": 1,
  "createdAt": "2026-09-09T00:00:00.000Z"
}
```
**索引**：`scene + status + sort`（复合，非唯一）

### 集合 2：`materials` 素材（身体/表情/挂件）
```json
{
  "_id": "mat_panda_wave",
  "scene": "body",
  "categoryId": "cat_panda",
  "categoryName": "熊猫",        // ⚠️ 冗余字段，避免二次查询（无 JOIN）
  "name": "熊猫-招手",
  "fileUrl": "cloud://env.xxx/body/panda_wave.png",
  "httpsUrl": "https://env.xxx.tcb.qcloud.la/body/panda_wave.png",  // 分享到外部用
  "fileType": "png",
  "width": 480, "height": 480, "size": 86000,
  "anchor": { "x": 0.5, "y": 0.5 },   // 表情/挂件对身体的贴合锚点
  "defaultScale": 1.0,
  "sort": 100,
  "status": 1,
  "useCount": 12482,
  "createdBy": "admin",
  "createdAt": "2026-09-09T00:00:00.000Z"
}
```
**索引**：`scene + status + sort`、`categoryId`、`useCount`（降序，热门排序）

### 集合 3：`text_templates` 文字模板
```json
{
  "content": "哈哈哈哈哈",
  "style": "stroke",            // stroke描边 | solid黑底 | color彩色
  "fontName": "PingFangSC-Bold",
  "color": "#000000",
  "bgColor": null,
  "position": "bottom",         // top | center | bottom
  "sort": 1, "status": 1, "useCount": 0
}
```

### 集合 4：`stickers` 表情仓库
```json
{
  "title": "快乐熊猫",
  "coverUrl": "cloud://env.xxx/sticker/panda.png",
  "fileUrl": "cloud://env.xxx/sticker/panda.png",
  "type": "gif",
  "categoryId": "cat_hot",
  "tags": ["熊猫", "搞笑", "热门"],   // 数组字段，直接建索引
  "authorName": "官方",               // 无用户投稿，全部由运营上传
  "useCount": 126000, "favoriteCount": 34000, "shareCount": 8902,
  "isHot": true, "isRecommend": true,
  "sort": 1,
  "status": "online",                 // online | offline（无审核态）
  "createdAt": "2026-09-09T00:00:00.000Z"
}
```
**索引**：`status + sort`、`isHot + useCount`、`tags`（数组索引）
**搜索方案**：`db.RegExp({ regexp: keyword, options: 'i' })` 匹配 `title`；标签走 `tags` 数组查询。数据量过万后接微信「内容安全+搜索」或自建 ES。

### 集合 5：`tool_configs` 工具配置
```json
{
  "scene": "gif",                     // gif | more
  "groupName": null,                  // 更多工具下的分组：图片处理/文字玩法
  "name": "视频转GIF",
  "code": "video2gif",
  "iconClass": "fa-film",
  "iconColor": "#5B5FE9",
  "jumpPath": "/pages/gif/video",
  "isNew": false, "isHot": true,
  "sort": 1, "status": 1
}
```

### 集合 6：`user_works` 用户作品（仅本地，无审核）
```json
{
  "_openid": "oXXXX",                 // 自动注入，天然隔离用户
  "title": "打工人日常",
  "fileUrl": "cloud://env.xxx/works/xxx.gif",
  "thumbUrl": "cloud://env.xxx/works/xxx_thumb.png",
  "type": "gif",
  "isDraft": false,
  "layers": [                          // 图层 JSON，支持再次编辑
    { "type": "body",      "materialId": "mat_panda_wave", "x": 0.5, "y": 0.5, "scale": 1, "rotate": 0 },
    { "type": "face",      "materialId": "mat_face_laugh", "x": 0.5, "y": 0.38, "scale": 0.6, "rotate": 0 },
    { "type": "accessory", "materialId": "mat_crown",      "x": 0.62, "y": 0.18, "scale": 0.5, "rotate": 12 },
    { "type": "text",      "content": "哈哈哈", "style": "stroke", "x": 0.5, "y": 0.85, "scale": 1 }
  ],
  "createdAt": "2026-09-09T00:00:00.000Z"
}
```
> 作品只存在 `user_works` 里供本人「我的制作」列表读取，**不进入 `stickers`、不公开、无 status/审核字段**。
> 用户点击「保存到相册」后生成的是本地图片，服务端不需要留存。

**索引**：`_openid + createdAt`（我的制作列表）

### 集合 7：`material_packages` 素材版本包（**关键优化**）
```json
{
  "scene": "body",
  "version": 12,
  "fileUrl": "cloud://env.xxx/manifest/body_v12.json",
  "itemCount": 236,
  "md5": "a1b2c3d4...",
  "updatedAt": "2026-09-09T00:00:00.000Z"
}
```
**索引**：`scene`（唯一）

### 集合 8：`admins` / `admin_logs`（自建后台时需要）
```json
{ "username": "admin", "password": "<bcrypt>", "role": "super", "status": 1, "lastLogin": null }
```
**权限必须设为「仅管理端可读写」**，绝不能让小程序端读到。

---

## 四、⚠️ 三个必须提前处理的坑

### 坑 1：GIF 重计算，云函数跑不了 ffmpeg
云函数环境**没有 ffmpeg**，且限制：内存最大 2GB、超时最长 60s、/tmp 仅 512MB。

**分层解决**：

| 工具 | 方案 |
|---|---|
| 多图转GIF | 云函数 + `gifencoder` npm 包（纯 JS）✅ |
| GIF加文字 / 改大小 / 旋转 / 镜像 | 云函数 + `sharp`/`jimp` ✅ |
| **视频转GIF** | 云托管 CloudBase Run 部署 ffmpeg Docker 容器 |
| GIF 变速 / 逐帧裁剪 | 同上，云托管 |
| GIF 转视频 | 同上，云托管 |

**云托管优势**：无 60s 超时、可常驻实例、CPU 密集不受限，按量计费。
**任务模式必须异步**：创建任务 → 写 `gif_tasks` 集合（status: processing）→ 前端轮询或订阅消息通知，绝不能同步等待。

### 坑 2：端上查询条数限制
- 小程序端 `.get()` 单次最多 **20 条**，云函数内最多 **100 条**
- 素材 1200+ 条、表情 3000+ 条 → 直接查库会又慢又费钱（按读次数计费）

**解法（强烈推荐）**：素材走 **manifest 打包 JSON**
```
管理员上传素材 → 云函数自动重新生成 body_v13.json → 存云存储 → 更新 material_packages.version
小程序启动 → 带本地 version 请求 → 版本一致走缓存，不一致下载整包（几百 KB，一次搞定）
```
表情仓库仍走数据库分页（内容多、需搜索、需实时上下架）。

### 坑 3：制作页 canvas 合成与导出（前端最难点）
本产品没有 UGC 审核，所以真正的技术难点落在**制作页合成**上：

```js
// 1. 网络图片必须先下载到本地临时路径，canvas 才能绘制
const { tempFilePath } = await wx.cloud.downloadFile({ fileID: material.fileUrl })

// 2. 按图层顺序绘制（身体 → 表情 → 挂件 → 文字）
const ctx = wx.createCanvasContext('stage')   // 或用 canvas 2d
ctx.drawImage(bodyPath, 0, 0, 300, 300)
ctx.drawImage(facePath, faceX, faceY, faceW, faceH)

// 3. 导出：destWidth 按像素比放大，否则保存出来是模糊的
wx.canvasToTempFilePath({
  canvasId: 'stage',
  destWidth: 300 * dpr, destHeight: 300 * dpr,
  success: res => wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath })
})
```

**三个必踩的点**：
1. `downloadFile` 合法域名——云存储的 `cloud://` 与 `*.tcb.qcloud.la` 默认放行，用第三方图床必须去后台配白名单
2. `saveImageToPhotosAlbum` 需要 `scope.writePhotosAlbum` 授权，被拒后要引导用户去设置页，否则点保存无反应
3. 图层坐标要按 **百分比** 存（见 `user_works.layers`），不能存绝对像素，否则不同机型错位

---

## 五、管理后台：三种方案对比

| 方案 | 成本 | 适合 | 说明 |
|---|---|---|---|
| **A. 云开发 CMS** | 1 天 | 推荐 MVP | 控制台开通 → 建内容模型（对应集合）→ 静态托管部署 → 运营直接用。支持图片上传、上下架字段、富文本，但**复杂联动（如自动重新生成 manifest）做不到** |
| **B. 自建 Vue 后台** | 3-5 天 | 长期 | 复用你已有的 `vue-admin-template + ElementUI`，部署到**云开发静态网站托管**，鉴权走云函数 + admins 集合。可控性最高，我之前给的 `emoji_admin` 原型可直接翻译 |
| **C. 控制台手动改** | 0 | 仅调试 | 开发期临时用 |

**推荐路径**：先上 CMS 跑起来（1 天），运营验证后再用方案 B 替换（届时需求已经明确，不会做错）。

---

## 六、成本估算

| 阶段 | 配置 | 月成本 |
|---|---|---|
| 开发/内测 | 基础版（免费额度） | ¥0 |
| 1万 DAU | 按量：数据库读 ~200万次 + CDN 50GB | ¥100-300 |
| 10万 DAU | 需升级套餐 + 云托管 ffmpeg 常驻 | ¥800-2000+ |

> CDN 流量是大头：表情包被大量分享会显著拉高，建议素材图片统一压缩 + WebP。

---

## 七、风险与迁移

| 风险 | 说明 | 缓解 |
|---|---|---|
| 生态锁定 | 云开发数据库绑死微信生态，未来做 App/Web 端要重写 | 数据层用云函数封装，业务逻辑不直接散落在页面里 |
| 复杂查询弱 | 无 JOIN、无全文检索、聚合能力有限 | 冗余字段 + manifest 打包；数据量过万再考虑自建 |
| 关系型需求增长 | 未来做订单/分销/分账会吃力 | 届时自建 Django 后端，云开发降级为内容 CDN |

**判断标准**：
- 只做微信小程序、快速验证 → **云开发，别犹豫**
- 确定要多端（App/H5/Web）、有复杂交易 → **直接自建后端**，云开发只当存储

---

## 八、落地排期（1-2 周）

| 天数 | 任务 |
|---|---|
| D1-2 | 开通云开发 → 建 8 个集合 + 索引 + **权限规则**（素材/仓库设为"所有用户可读，仅管理端可写"） |
| D3 | CMS 开通 + 内容模型配置 → 上传首批素材 |
| D4-5 | manifest 生成云函数 + 小程序端素材读取 + 本地缓存 |
| D6-8 | 制作页 canvas 图层合成 + `canvasToTempFilePath` 导出 + 保存相册授权 |
| D9-10 | 轻量 GIF 工具（多图转GIF/加文字/改大小）走云函数 |
| D11 | 视频转GIF 走云托管 ffmpeg 容器 + 异步任务轮询 |
| D12 | 我的制作（本地草稿/作品列表 + 图层回放） + 使用量埋点统计 |
| D13-14 | 真机测试 + 提审 |

> 相比含投稿的版本**省掉了 D12 的审核与内容安全**，整体可压缩到 10-12 天。

---

## 九、关键代码片段

### 小程序端读取素材（带版本缓存）
```js
const localVersion = wx.getStorageSync('material_version_body') || 0
const { result } = await wx.cloud.callFunction({
  name: 'materialService',
  data: { action: 'check', scene: 'body', version: localVersion }
})
// result: { needUpdate: false } 或 { needUpdate: true, version: 13, fileID: 'cloud://...' }
if (result.needUpdate) {
  const res = await wx.cloud.downloadFile({ fileID: result.fileID })
  const list = JSON.parse(wx.getFileSystemManager().readFileSync(res.tempFilePath, 'utf8'))
  wx.setStorageSync('material_body', list)
  wx.setStorageSync('material_version_body', result.version)
}
```

### 云函数重新生成 manifest（管理员上传素材后调用）
```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { scene } = event
  const all = []
  let skip = 0
  while (true) {
    const batch = await db.collection('materials')
      .where({ scene, status: 1 }).orderBy('sort', 'asc').skip(skip).limit(100).get()
    all.push(...batch.data)
    if (batch.data.length < 100) break
    skip += 100
  }
  const { fileID } = await cloud.uploadFile({
    cloudPath: `manifest/${scene}_v${Date.now()}.json`,
    fileContent: Buffer.from(JSON.stringify(all))
  })
  await db.collection('material_packages').where({ scene }).update({
    data: { version: Date.now(), fileUrl: fileID, itemCount: all.length, updatedAt: new Date() }
  })
  return { itemCount: all.length }
}
```

### 权限规则（必须配置）
```json
// materials / stickers / tool_configs
{ "read": true, "write": "doc.status == 1" }   // 或更严格：write: false（仅管理端）
// user_works
{ "read": "doc._openid == auth.openid", "write": "doc._openid == auth.openid" }
// admins / admin_logs
{ "read": false, "write": false }              // 仅云函数（管理端）可访问
```

---

## 十、结论

**用微信开发者工具 + 云开发完全可行，且 MVP 阶段是最优解。**

四条执行原则：
1. **素材走 manifest 打包分发**，不要每次查数据库（省读次数、省时间、省钱）
2. **GIF 重计算走云托管 ffmpeg 容器**，不要硬塞云函数
3. **后台先用 CMS 跑起来**，跑通后再投入自建 Vue 后台
4. **无投稿 = 无审核**：只做「素材 + 仓库 + 工具配置 + 数据统计」四块，工作量比通用 UGC 产品少约 30%

补充一点：你原本熟悉的 Django 在这套方案里用不上后端部分，但**如果产品跑通后确定要多端/复杂交易，随时可以平滑迁移**——只要把业务逻辑封在云函数里，不散落在页面。

---

## 附：若未来开放「投稿到表情仓库」需要补什么

当前不做，但结构已预留，将来加这一块只需 4 步：

| 步骤 | 内容 |
|---|---|
| 1 | `stickers` 集合 status 加回 `pending` / `rejected`，增加 `auditRemark`、`submitterOpenid` 字段 |
| 2 | 投稿云函数内调用 `cloud.openapi.security.imgSecCheck` 做机审，通过后写 `status: pending` |
| 3 | 后台加「投稿审核」列表页（可用之前那版 `admin_works` 原型），通过 → 写入 `stickers` 并 `status: online` |
| 4 | 小程序端加「我的投稿」状态展示 + 订阅消息通知审核结果 |

> 提前知道补法的价值：现在建集合时 `stickers` 保留 `authorName` 字段、`user_works` 保留 `layers` 结构，将来开放投稿**不需要改数据结构**，只加字段。
