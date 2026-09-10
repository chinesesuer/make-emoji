const sceneLabels = { body: '选身体', face: '选表情', accessory: '选挂件' };
Page({
  data: { scene: 'body', scenes: [{ key: 'body', label: '选身体' }, { key: 'face', label: '选表情' }, { key: 'accessory', label: '选挂件' }], list: [], showUpload: false, uploading: false, categoryName: '', sort: 100, selectedFiles: [], adminName: '' },
  onShow() { if (!wx.getStorageSync('adminToken')) return wx.redirectTo({ url: '/pages/adminLogin/adminLogin' }); this.setData({ adminName: wx.getStorageSync('adminName') || '管理员' }); this.loadList(); },
  async call(data) { const { result } = await wx.cloud.callFunction({ name: 'materialAdmin', data: { ...data, token: wx.getStorageSync('adminToken') } }); if (!result.success && result.message === '登录已过期') { wx.removeStorageSync('adminToken'); wx.redirectTo({ url: '/pages/adminLogin/adminLogin' }); } return result; },
  async loadList() { wx.showLoading({ title: '加载中' }); try { const result = await this.call({ action: 'list', scene: this.data.scene }); if (result.success) this.setData({ list: result.list }); } catch (_) { wx.showToast({ title: '素材加载失败', icon: 'none' }); } finally { wx.hideLoading(); } },
  switchScene(e) { this.setData({ scene: e.currentTarget.dataset.scene }); this.loadList(); },
  openUpload() { this.setData({ showUpload: true, categoryName: '', sort: 100, selectedFiles: [] }); }, closeUpload() { this.setData({ showUpload: false }); },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  chooseImage() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      success: res => this.setData({ selectedFiles: res.tempFiles.map(file => ({ path: file.tempFilePath, size: file.size, name: file.tempFilePath.split('/').pop().replace(/\.[^.]+$/, '') })) })
    });
  },
  async upload() {
    const { selectedFiles, categoryName, scene, sort } = this.data;
    if (!selectedFiles.length || !categoryName) return wx.showToast({ title: '请选择图片并填写分类', icon: 'none' });
    this.setData({ uploading: true });
    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const item = selectedFiles[index];
        const ext = (item.path.match(/\.([^.]+)$/) || ['', 'png'])[1].toLowerCase();
        const file = await wx.cloud.uploadFile({ cloudPath: `materials/${scene}/${Date.now()}_${index}_${Math.random().toString(36).slice(2)}.${ext}`, filePath: item.path });
        const result = await this.call({ action: 'create', material: { scene, name: item.name, categoryName, sort: Number(sort) + index, size: item.size, fileType: ext, fileUrl: file.fileID } });
        if (!result.success) throw new Error(result.message);
      }
      wx.showToast({ title: `成功上传${selectedFiles.length}个`, icon: 'success' }); this.closeUpload(); this.loadList();
    } catch (error) { wx.showToast({ title: error.message || '上传失败', icon: 'none' }); } finally { this.setData({ uploading: false }); }
  },
  remove(e) { const { id, name } = e.currentTarget.dataset; wx.showModal({ title: '删除素材', content: `确定删除“${name}”吗？此操作不可恢复。`, success: async res => { if (!res.confirm) return; wx.showLoading({ title: '删除中' }); const result = await this.call({ action: 'remove', id }); wx.hideLoading(); if (result.success) { wx.showToast({ title: '已删除', icon: 'success' }); this.loadList(); } else wx.showToast({ title: result.message || '删除失败', icon: 'none' }); } }); },
  logout() { wx.removeStorageSync('adminToken'); wx.redirectTo({ url: '/pages/adminLogin/adminLogin' }); }, sceneName() { return sceneLabels[this.data.scene]; }
});
