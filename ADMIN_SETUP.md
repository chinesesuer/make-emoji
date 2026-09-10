# 素材管理后台部署说明

## 1. 配置云环境

在 `miniprogram/app.js` 的 `env` 填入云开发环境 ID。

## 2. 创建集合与权限

在云开发控制台创建以下集合：

- `materials`：小程序端可读；客户端禁止写入。
- `admins`：客户端禁止读写。
- `admin_sessions`：客户端禁止读写。

素材上传文件存放在云存储的 `materials/` 路径。请按项目实际安全策略限制云存储写入；素材记录的创建与删除已经由 `materialAdmin` 云函数鉴权。

## 3. 初始化管理员

在 `admins` 集合手动新增一条记录。`passwordHash` 为密码的 SHA-256 值；示例密码 `123456` 的值为：

```json
{
  "username": "admin",
  "passwordHash": "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
  "status": 1,
  "role": "super",
  "createdAt": "2026-09-09T00:00:00.000Z"
}
```

上线前请使用强密码并生成新的 SHA-256 值，勿使用示例密码。

## 4. 部署云函数

在微信开发者工具中分别右键上传并部署：

- `cloudfunctions/materialService`
- `cloudfunctions/materialAdmin`

## 5. 使用管理端

在开发者工具中打开 `pages/adminLogin/adminLogin`，登录成功后进入素材管理。上传后的素材会写入云数据库，首页重新进入时会从 `materials` 集合获取全部已上架素材。
