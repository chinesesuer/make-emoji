const STORAGE_PREFIX = 'emojiDailyUsage:';
const BASE_DAILY_QUOTA = 8;

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function storageKey(user) { return `${STORAGE_PREFIX}${String(user && user.openid || 'guest')}`; }

function readUsage(user) {
  if (!user) return null;
  const date = today();
  const saved = wx.getStorageSync(storageKey(user));
  const isCurrentDay = saved && typeof saved === 'object' && saved.date === date;
  const usage = { date, used: isCurrentDay ? Math.max(0, Number(saved.used) || 0) : 0, bonus: isCurrentDay ? Math.max(0, Number(saved.bonus) || 0) : 0 };
  if (!isCurrentDay) wx.setStorageSync(storageKey(user), usage);
  return usage;
}

function getDailyQuota(user) {
  const usage = readUsage(user);
  if (!usage) return null;
  const total = BASE_DAILY_QUOTA + usage.bonus;
  const used = Math.min(usage.used, total);
  return { ...usage, total, used, remaining: Math.max(0, total - used) };
}

function consumeUsage(user) {
  const quota = getDailyQuota(user);
  if (!quota || quota.remaining < 1) {
    wx.showModal({ title: '今日免费次数已用完', content: '明天会自动恢复 8 次基础额度，也可以邀请好友获得更多次数。', showCancel: false, confirmText: '知道了' });
    return null;
  }
  wx.setStorageSync(storageKey(user), { date: quota.date, used: quota.used + 1, bonus: quota.bonus });
  return getDailyQuota(user);
}

module.exports = { BASE_DAILY_QUOTA, getDailyQuota, consumeUsage };
