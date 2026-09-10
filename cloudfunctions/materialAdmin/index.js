const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const ADMIN_TTL = 8 * 60 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');

async function verify(token) {
  if (!token) throw new Error('请先登录');
  const session = await db.collection('admin_sessions').where({ token }).get();
  const current = session.data[0];
  if (!current || current.expiresAt < Date.now()) throw new Error('登录已过期');
  return current;
}

async function login({ username, password }) {
  if (!username || !password) return { success: false, message: '请输入账号和密码' };
  const result = await db.collection('admins').where({ username, status: 1 }).limit(1).get();
  const admin = result.data[0];
  if (!admin || admin.passwordHash !== hash(password)) return { success: false, message: '账号或密码错误' };
  const token = crypto.randomBytes(32).toString('hex');
  await db.collection('admin_sessions').add({ data: { token, adminId: admin._id, username: admin.username, expiresAt: Date.now() + ADMIN_TTL, createdAt: new Date() } });
  await db.collection('admins').doc(admin._id).update({ data: { lastLogin: new Date() } });
  return { success: true, token, username: admin.username };
}

async function list(event) {
  await verify(event.token);
  const scene = event.scene || 'body';
  const query = { scene };
  if (event.keyword) query.name = db.RegExp({ regexp: event.keyword, options: 'i' });
  const result = await db.collection('materials').where(query).orderBy('sort', 'asc').limit(100).get();
  return { success: true, list: result.data };
}

async function create(event) {
  const session = await verify(event.token);
  const material = event.material || {};
  if (!['body', 'face', 'accessory'].includes(material.scene) || !material.name || !material.fileUrl) throw new Error('素材信息不完整');
  const data = { scene: material.scene, name: material.name.trim(), categoryName: material.categoryName || '未分类', fileUrl: material.fileUrl, fileType: material.fileType || 'png', sort: Number(material.sort) || 100, status: 1, width: Number(material.width) || 0, height: Number(material.height) || 0, size: Number(material.size) || 0, createdBy: session.username, createdAt: new Date() };
  const result = await db.collection('materials').add({ data });
  return { success: true, id: result._id, material: { ...data, _id: result._id } };
}

async function remove(event) {
  await verify(event.token);
  const material = await db.collection('materials').doc(event.id).get();
  if (material.data.fileUrl) await cloud.deleteFile({ fileList: [material.data.fileUrl] });
  await db.collection('materials').doc(event.id).remove();
  return { success: true };
}

exports.main = async event => {
  try {
    if (event.action === 'login') return await login(event);
    if (event.action === 'list') return await list(event);
    if (event.action === 'create') return await create(event);
    if (event.action === 'remove') return await remove(event);
    return { success: false, message: '未知操作' };
  } catch (error) { return { success: false, message: error.message || '操作失败' }; }
};
