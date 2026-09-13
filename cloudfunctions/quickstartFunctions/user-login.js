function sanitizeField(value, maximumLength) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function sanitizeProfile(profile = {}) {
  const nickName = sanitizeField(profile && profile.nickName, 40) || '微信用户';
  const avatarUrl = sanitizeField(profile && profile.avatarUrl, 1000);
  return { nickName, avatarUrl };
}

async function loginUser({ db, openid, profile, now = new Date() }) {
  if (!openid) {
    throw new Error('无法获取微信用户身份');
  }

  const userProfile = sanitizeProfile(profile);
  const users = db.collection('users');
  const existing = await users.where({ _openid: openid }).limit(1).get();
  const data = { ...userProfile, lastLoginAt: now };

  if (existing.data.length > 0) {
    await users.doc(existing.data[0]._id).update({ data });
  } else {
    await users.add({ data: { _openid: openid, ...data, createdAt: now } });
  }

  return { success: true, user: { openid, ...userProfile } };
}

module.exports = { loginUser, sanitizeProfile };
