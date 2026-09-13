const { getCurrentUser, ensureLogin } = require('../../utils/auth');

Page({
  data: { user: null, loggedIn: false },
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: this.route });
    this.refreshUser();
  },
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
  },
  comingSoon() { wx.showToast({ title: '功能即将上线', icon: 'none' }); }
});
