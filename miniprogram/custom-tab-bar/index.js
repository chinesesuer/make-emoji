Component({
  data: {
    selected: '',
    tabs: [
      { path: 'pages/index/index', text: '制作表情', icon: '/images/tabbar/create.svg', activeIcon: '/images/tabbar/create-active.svg', active: false },
      { path: 'pages/gifTools/gifTools', text: 'GIF工具', icon: '/images/tabbar/gif.svg', activeIcon: '/images/tabbar/gif-active.svg', active: false },
      { text: '表情仓库', icon: '/images/tabbar/warehouse.svg', activeIcon: '/images/tabbar/warehouse-active.svg', active: false, disabled: true },
      { path: 'pages/moreTools/moreTools', text: '更多工具', icon: '/images/tabbar/tools.svg', activeIcon: '/images/tabbar/tools-active.svg', active: false },
      { path: 'pages/profile/profile', text: '个人中心', icon: '/images/tabbar/profile.svg', activeIcon: '/images/tabbar/profile-active.svg', active: false }
    ]
  },
  lifetimes: {
    attached() { this.syncActive(); }
  },
  methods: {
    syncActive() {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      const route = current && current.route;
      this.setData({ selected: route || '' });
    },
    switchTo(e) {
      const path = e.currentTarget.dataset.path;
      const target = this.data.tabs.find(tab => tab.path === path);
      if (!path) {
        wx.showToast({ title: '表情仓库即将上线', icon: 'none' });
        return;
      }
      if (!target || target.path === this.data.selected) return;
      wx.switchTab({ url: `/${path}` });
    }
  }
});
