Page({
  data: { username: '', password: '', loading: false },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  async login() {
    const { username, password } = this.data;
    if (!username || !password) return wx.showToast({ title: '请输入账号和密码', icon: 'none' });
    this.setData({ loading: true });
    try {
      const { result } = await wx.cloud.callFunction({ name: 'materialAdmin', data: { action: 'login', username, password } });
      if (!result.success) return wx.showToast({ title: result.message, icon: 'none' });
      wx.setStorageSync('adminToken', result.token);
      wx.setStorageSync('adminName', result.username);
      wx.redirectTo({ url: '/pages/adminMaterials/adminMaterials' });
    } catch (_) { wx.showToast({ title: '登录服务不可用', icon: 'none' }); }
    finally { this.setData({ loading: false }); }
  }
});
