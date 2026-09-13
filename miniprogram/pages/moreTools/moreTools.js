Page({
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: this.route });
  },
  openMixer() {
    wx.navigateTo({ url: '/pages/emojiMixer/emojiMixer' });
  },
  openDiy() {
    wx.navigateTo({ url: '/pages/diyEmoji/diyEmoji' });
  },
  openGridSlice() {
    wx.navigateTo({ url: '/pages/gridSlice/gridSlice' });
  },
  openTool(e) {
    const routes = {
      '表情包搜索': '',
      '每日榜单': ''
    };
    const name = e.currentTarget.dataset.name;
    if (routes[name]) wx.navigateTo({ url: routes[name] });
    else wx.showToast({ title: `${name}即将上线`, icon: 'none' });
  }
});
