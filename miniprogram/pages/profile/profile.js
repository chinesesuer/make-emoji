Page({
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: this.route });
  },
  comingSoon() { wx.showToast({ title: '功能即将上线', icon: 'none' }); }
});
