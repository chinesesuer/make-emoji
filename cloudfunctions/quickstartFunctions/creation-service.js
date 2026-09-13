const crypto = require('crypto');

function requireOpenid(openid) {
  if (typeof openid !== 'string' || !openid) throw new Error('无法获取微信用户身份');
}

function validateCreation({ fingerprint, fileID, fileType }) {
  if (!/^[0-9a-f]{16}$/.test(fingerprint || '')) throw new Error('作品指纹无效');
  if (typeof fileID !== 'string' || !fileID.trim()) throw new Error('作品文件无效');
  if (fileType !== 'png' && fileType !== 'jpg') throw new Error('作品格式无效');
}

function isMissingCollection(error) {
  const message = error && (error.errMsg || error.message || String(error));
  return Boolean(error && error.errCode === -502005) || /collection.+not exists|集合.+不存在/i.test(message || '');
}

function isMissingDocument(error) {
  const message = error && (error.errMsg || error.message || String(error));
  return Boolean(error && (error.errCode === -1 || error.errCode === -502003)) || /document.+not exists|文档.+不存在/i.test(message || '');
}

async function ensureCollection(db) {
  if (typeof db.createCollection !== 'function') return;
  try { await db.createCollection('creations'); } catch (error) { /* 并发创建可忽略 */ }
}

function recordId(openid, fingerprint) {
  return crypto.createHash('sha256').update(`${openid}:${fingerprint}`).digest('hex');
}

async function readRecord(db, collection, id) {
  try {
    const result = await collection.doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    if (isMissingCollection(error)) {
      await ensureCollection(db);
      return null;
    }
    if (isMissingDocument(error)) return null;
    throw error;
  }
}

async function saveCreation({ db, openid, fingerprint, fileID, fileType, now = new Date(), deleteFiles = async () => {} }) {
  requireOpenid(openid);
  validateCreation({ fingerprint, fileID, fileType });
  const collection = db.collection('creations');
  const id = recordId(openid, fingerprint);
  const existing = await readRecord(db, collection, id);
  const data = {
    _openid: openid,
    fingerprint,
    fileID: fileID.trim(),
    fileType,
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now
  };
  await collection.doc(id).set({ data });
  if (existing && existing.fileID && existing.fileID !== data.fileID) {
    try { await deleteFiles([existing.fileID]); } catch (error) { /* 新记录已生效，旧文件稍后清理 */ }
  }
  return { success: true, creation: { _id: id, fileID: data.fileID, fileType, createdAt: data.createdAt, updatedAt: now } };
}

async function listCreations({ db, openid, limit = 50 }) {
  requireOpenid(openid);
  const count = Math.max(1, Math.min(50, Number(limit) || 50));
  const collection = db.collection('creations');
  let result;
  try {
    result = await collection.where({ _openid: openid }).orderBy('updatedAt', 'desc').limit(count).get();
  } catch (error) {
    if (!isMissingCollection(error)) throw error;
    await ensureCollection(db);
    result = { data: [] };
  }
  const creations = (result.data || []).map(item => ({
    _id: item._id,
    fileID: item.fileID,
    fileType: item.fileType,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
  return { success: true, creations };
}

module.exports = { saveCreation, listCreations };
