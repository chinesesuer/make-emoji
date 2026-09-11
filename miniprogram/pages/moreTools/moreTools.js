Page({
  openMixer() {
    wx.navigateTo({ url: '/pages/emojiMixer/emojiMixer' });
  },
  openTool(e) {
    const routes = {
      '表情包搜索': '',
      '每日榜单': ''
    };
    const name = e.currentTarget.dataset.name;
    if (routes[name]) wx.navigateTo({ url: routes[name] });
    else wx.showToast({ title: `${name}即将上线`, icon: 'none' });
  },
  goCreate() {
    wx.redirectTo({ url: '/pages/index/index' });
  },
  goGifTools() {
    wx.redirectTo({ url: '/pages/gifTools/gifTools' });
  },
  goProfile() {
    wx.redirectTo({ url: '/pages/profile/profile' });
  }
});
