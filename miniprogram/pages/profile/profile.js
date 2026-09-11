Page({
  backToCreate() { wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: '/pages/index/index' }) }); },
  goMoreTools() { wx.navigateTo({ url: '/pages/moreTools/moreTools' }); },
  comingSoon() { wx.showToast({ title: '功能即将上线', icon: 'none' }); }
});
