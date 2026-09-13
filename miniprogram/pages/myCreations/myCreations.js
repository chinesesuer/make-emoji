const { ensureLogin } = require('../../utils/auth');

Page({
  data: { creations: [], loading: false, error: '' },
  onShow() { this.loadCreations(); },
  async loadCreations() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const user = await ensureLogin();
      if (!user) { this.setData({ loading: false }); return; }
      const response = await wx.cloud.callFunction({ name: 'quickstartFunctions', data: { type: 'listCreations' } });
      const result = response && response.result;
      if (!result || result.success !== true) throw new Error('作品列表响应无效');
      const creations = (result.creations || []).filter(item => item && item.fileID);
      if (!creations.length) { this.setData({ creations: [], loading: false, error: '' }); return; }
      const urlResult = await wx.cloud.getTempFileURL({ fileList: creations.map(item => item.fileID) });
      const urlMap = new Map((urlResult.fileList || []).map(item => [item.fileID, item.tempFileURL]));
      this.setData({ creations: creations.map(item => ({ ...item, tempFileURL: urlMap.get(item.fileID) || '' })).filter(item => item.tempFileURL), loading: false, error: '' });
    } catch (error) {
      console.error('loadCreations failed', error);
      this.setData({ loading: false, error: '加载失败，点击重试' });
    }
  },
  retryLoad() { this.loadCreations(); },
  previewCreation(e) {
    const current = e.currentTarget.dataset.url;
    const urls = this.data.creations.map(item => item.tempFileURL).filter(Boolean);
    if (current && urls.length) wx.previewImage({ current, urls });
  }
});
