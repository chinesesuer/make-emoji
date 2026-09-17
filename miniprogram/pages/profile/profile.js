const { getCurrentUser, ensureLogin } = require('../../utils/auth');
const { BASE_DAILY_QUOTA, getDailyQuota } = require('../../utils/usage-quota');

Page({
  data: { user: null, loggedIn: false, quota: null, segments: [] },
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: this.route });
    this.refreshUser();
  },
  refreshUser() {
    const user = getCurrentUser();
    const quota = getDailyQuota(user);
    this.setData({
      user,
      loggedIn: !!user,
      quota,
      segments: quota ? Array.from({ length: BASE_DAILY_QUOTA }, (_, index) => ({ used: index < Math.min(quota.used, BASE_DAILY_QUOTA) })) : []
    });
  },
  async login() {
    const user = await ensureLogin();
    if (user) {
      const quota = getDailyQuota(user);
      this.setData({ user, loggedIn: true, quota, segments: quota ? Array.from({ length: BASE_DAILY_QUOTA }, (_, index) => ({ used: index < Math.min(quota.used, BASE_DAILY_QUOTA) })) : [] });
    }
  },
  async openUserFeature(e) {
    const user = await ensureLogin();
    if (!user) return;
    this.refreshUser();
    if (e.currentTarget.dataset.action === 'creations') {
      wx.navigateTo({ url: '/pages/myCreations/myCreations' });
      return;
    }
    wx.showToast({ title: `${e.currentTarget.dataset.name}即将上线`, icon: 'none' });
  },
  inviteFriends() {
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    wx.showToast({ title: '邀请好友可获得 +3 次', icon: 'none' });
  },
  comingSoon() { wx.showToast({ title: '功能即将上线', icon: 'none' }); }
});
