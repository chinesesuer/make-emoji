Page({
  data: {
    tools: [
      { name: '视频转GIF', icon: '/images/gif-tools/film.svg' },
      { name: '多图转GIF', icon: '/images/gif-tools/images.svg' },
      { name: 'GIF裁剪', icon: '/images/gif-tools/crop.svg' },
      { name: 'GIF剪切', icon: '/images/gif-tools/scissors.svg' },
      { name: 'GIF变速', icon: '/images/gif-tools/gauge.svg' },
      { name: 'GIF加文字', icon: '/images/gif-tools/pen.svg' },
      { name: 'GIF旋转', icon: '/images/gif-tools/rotate-cw.svg' },
      { name: 'GIF镜像', icon: '/images/gif-tools/arrow-left-right.svg' },
      { name: 'GIF改大小', icon: '/images/gif-tools/expand.svg' },
      { name: 'GIF转视频', icon: '/images/gif-tools/circle-play.svg' },
      { name: 'GIF帧转图片', icon: '/images/gif-tools/image.svg' }
    ]
  },
  openTool(e) {
    if (e.currentTarget.dataset.name === '视频转GIF') {
      wx.navigateTo({ url: '/pages/gifVideo/gifVideo' });
      return;
    }
    if (e.currentTarget.dataset.name === '多图转GIF') {
      wx.navigateTo({ url: '/pages/gifImages/gifImages' });
      return;
    }
    if (e.currentTarget.dataset.name === 'GIF加文字') {
      wx.navigateTo({ url: '/pages/gifText/gifText' });
      return;
    }
    wx.showToast({ title: `${e.currentTarget.dataset.name}即将上线`, icon: 'none' });
  },
  goCreate() {
    wx.navigateBack({ delta: 1, fail: () => wx.redirectTo({ url: '/pages/index/index' }) });
  },
  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },
  goMoreTools() {
    wx.navigateTo({ url: '/pages/moreTools/moreTools' });
  },
  comingSoon() {
    wx.showToast({ title: '功能即将上线', icon: 'none' });
  }
});
