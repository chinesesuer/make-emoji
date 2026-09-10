const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const scene = event.scene;
  if (!['body', 'face', 'accessory'].includes(scene)) {
    return { success: false, message: '无效的素材类型' };
  }
  const limit = Math.min(Number(event.limit) || 100, 100);
  const result = await db.collection('materials')
    .where({ scene, status: 1 })
    .orderBy('sort', 'asc')
    .limit(limit)
    .get();
  return { success: true, list: result.data };
};
