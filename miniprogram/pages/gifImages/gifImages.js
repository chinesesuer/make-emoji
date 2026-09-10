Page({
  data: {
    images: [], previewIndex: 0, fps: 5, loop: 0, resolution: 320, resolutionLabel: '320p',
    resolutions: [{ label: '原图', value: 0 }, { label: '240p', value: 240 }, { label: '320p', value: 320 }, { label: '480p', value: 480 }],
    dragIndex: -1, cropMode: 'contain', targetRatio: 1, previewHeight: 390, generating: false, generatingText: '', generatedGif: '', resultVisible: false
  },
  onUnload() { this.stopPreview(); },
  goBack() { wx.navigateBack(); },
  startPreview() {
    this.stopPreview();
    if (this.data.images.length < 2) return;
    this.previewTimer = setInterval(() => this.setData({ previewIndex: (this.data.previewIndex + 1) % this.data.images.length }), Math.max(50, Math.round(1000 / this.data.fps)));
  },
  stopPreview() { if (this.previewTimer) clearInterval(this.previewTimer); this.previewTimer = null; },
  wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },
  async auditImage(fileID, contentType) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await wx.cloud.callFunction({ name: 'gifImages', data: { action: 'audit', fileID, contentType } });
        const result = response.result;
        if (!result) throw new Error('审核服务未返回结果');
        // 只有微信内容安全接口给出的明确结论才算审核结果；超时、网络错误不能当成违规。
        if (result.success || result.suggest === 'risky' || result.suggest === 'review') return result;
        lastError = new Error(result.message || '审核服务暂时不可用');
      } catch (error) { lastError = error; }
      if (attempt < 3) await this.wait(attempt * 500);
    }
    throw lastError || new Error('审核服务暂时不可用');
  },
  getImageInfo(src) {
    return new Promise((resolve, reject) => wx.getImageInfo({ src, success: resolve, fail: reject }));
  },
  askCrop() {
    return new Promise(resolve => wx.showModal({
      title: '图片长宽不一致',
      content: '是否按第一张图片的长宽比例居中裁剪？选择“不裁剪”将保留完整画面，空白区域会自动留白。',
      confirmText: '统一裁剪',
      cancelText: '不裁剪',
      success: result => resolve(result.confirm ? 'cover' : 'contain'),
      fail: () => resolve('contain')
    }));
  },
  async chooseImages() {
    const available = 20 - this.data.images.length;
    if (available <= 0) return wx.showToast({ title: '最多选择20张', icon: 'none' });
    try {
      const result = await wx.chooseMedia({ count: available, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] });
      if (!result.tempFiles.length) return;
      wx.showLoading({ title: '图片审核中', mask: true });
      const accepted = [];
      for (let i = 0; i < result.tempFiles.length; i += 1) {
        const path = result.tempFiles[i].tempFilePath;
        const extension = (path.match(/\.([a-zA-Z0-9]+)(?:\?|$)/) || [])[1] || 'jpg';
        const contentType = extension.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
        const upload = await wx.cloud.uploadFile({ cloudPath: `gif-audit/${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.${extension}`, filePath: path });
        try {
          const check = await this.auditImage(upload.fileID, contentType);
          await wx.cloud.deleteFile({ fileList: [upload.fileID] }).catch(() => {});
          if (check.success) {
            const info = await this.getImageInfo(path);
            accepted.push({ id: `${Date.now()}-${i}`, path, width: info.width, height: info.height, ratio: info.width / info.height });
          }
        } catch (error) {
          await wx.cloud.deleteFile({ fileList: [upload.fileID] }).catch(() => {});
          throw error;
        }
      }
      const rejected = result.tempFiles.length - accepted.length;
      const images = this.data.images.concat(accepted);
      const targetRatio = images.length ? images[0].ratio : 1;
      const hasDifferentRatios = images.some(item => Math.abs(item.ratio - targetRatio) / targetRatio > 0.01);
      wx.hideLoading();
      const cropMode = hasDifferentRatios ? await this.askCrop() : 'contain';
      // 预览内容宽约 662rpx；统一裁剪时按目标比例反推高度，使预览边界与成品 GIF 一致。
      const previewHeight = cropMode === 'cover' ? Math.max(180, Math.round(662 / targetRatio + 28)) : 390;
      this.setData({ images, cropMode, targetRatio, previewHeight, previewIndex: 0 }, () => this.startPreview());
      if (rejected) wx.showModal({ title: '部分图片未通过审核', content: `${rejected} 张图片被微信内容安全接口判定为需复审或存在风险，未加入列表。`, showCancel: false });
    } catch (error) {
      if (!String(error.errMsg || error.message).includes('cancel')) wx.showModal({ title: '审核服务暂时不可用', content: '图片没有被判定为违规。本次是审核接口超时或网络异常，请稍后重试。', showCancel: false });
    } finally { wx.hideLoading(); }
  },
  cleanupCloudFiles(items) {
    const fileList = items.map(item => item.auditFileID).filter(Boolean);
    if (fileList.length) wx.cloud.deleteFile({ fileList }).catch(() => {});
  },
  removeImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    const images = this.data.images.slice();
    const removed = images.splice(index, 1);
    this.cleanupCloudFiles(removed);
    this.setData({ images, previewIndex: images.length ? Math.min(this.data.previewIndex, images.length - 1) : 0 }, () => this.startPreview());
  },
  reselect() { this.cleanupCloudFiles(this.data.images); this.stopPreview(); this.setData({ images: [], previewIndex: 0, cropMode: 'contain', targetRatio: 1, previewHeight: 390 }); },
  startDrag(e) {
    const point = e.touches[0];
    this.dragPoint = { x: point.clientX, y: point.clientY };
    this.setData({ dragIndex: Number(e.currentTarget.dataset.index) });
    wx.vibrateShort({ type: 'light' });
  },
  moveDrag(e) {
    if (this.data.dragIndex < 0 || !e.touches[0]) return;
    const point = e.touches[0];
    const dx = point.clientX - this.dragPoint.x;
    const dy = point.clientY - this.dragPoint.y;
    const columnStep = Math.abs(dx) > 45 ? (dx > 0 ? 1 : -1) : 0;
    const rowStep = Math.abs(dy) > 60 ? (dy > 0 ? 4 : -4) : 0;
    const steps = columnStep || rowStep;
    if (!steps) return;
    const target = Math.max(0, Math.min(this.data.images.length - 1, this.data.dragIndex + steps));
    if (target === this.data.dragIndex) return;
    const images = this.data.images.slice();
    const moved = images.splice(this.data.dragIndex, 1)[0];
    images.splice(target, 0, moved);
    this.dragPoint = { x: point.clientX, y: point.clientY };
    this.setData({ images, dragIndex: target, previewIndex: 0 });
  },
  endDrag() { if (this.data.dragIndex >= 0) this.setData({ dragIndex: -1 }, () => this.startPreview()); },
  changeFps(e) { this.setData({ fps: Number(e.detail.value) }, () => this.startPreview()); },
  chooseResolution(e) { const resolution = Number(e.currentTarget.dataset.value); this.setData({ resolution, resolutionLabel: resolution ? `${resolution}p` : '原图' }); },
  loopMinus() { this.setData({ loop: this.data.loop === 0 ? 1 : Math.max(0, this.data.loop - 1) }); },
  loopPlus() { if (this.data.loop !== 0) this.setData({ loop: Math.min(99, this.data.loop + 1) }); },
  getCanvas() {
    return new Promise((resolve, reject) => this.createSelectorQuery().select('#frameCanvas').fields({ node: true, size: true }).exec(r => r[0] ? resolve(r[0].node) : reject(new Error('canvas unavailable'))));
  },
  loadCanvasImage(canvas, src) { return new Promise((resolve, reject) => { const image = canvas.createImage(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; }); },
  async prepareFrame(canvas, item, outputWidth, outputHeight, index) {
    const info = item.width && item.height ? item : await this.getImageInfo(item.path);
    const image = await this.loadCanvasImage(canvas, item.path);
    canvas.width = outputWidth; canvas.height = outputHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, outputWidth, outputHeight);
    const ratio = this.data.cropMode === 'cover'
      ? Math.max(outputWidth / info.width, outputHeight / info.height)
      : Math.min(outputWidth / info.width, outputHeight / info.height);
    const width = info.width * ratio; const height = info.height * ratio;
    ctx.drawImage(image, (outputWidth - width) / 2, (outputHeight - height) / 2, width, height);
    const path = await new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, fileType: 'png', destWidth: outputWidth, destHeight: outputHeight, success: r => resolve(r.tempFilePath), fail: reject }));
    const upload = await wx.cloud.uploadFile({ cloudPath: `gif-frames/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.png`, filePath: path });
    return upload.fileID;
  },
  async generateGif() {
    if (this.data.images.length < 2 || this.data.generating) return;
    this.setData({ generating: true, generatingText: '正在准备图片…' }); wx.showLoading({ title: '准备图片 0%', mask: true });
    let frameIDs = [];
    try {
      const canvas = await this.getCanvas();
      let size = this.data.resolution;
      if (!size) { const info = this.data.images[0]; size = Math.min(480, Math.max(info.width, info.height)); }
      const ratio = this.data.targetRatio || 1;
      const outputWidth = ratio >= 1 ? size : Math.max(1, Math.round(size * ratio));
      const outputHeight = ratio >= 1 ? Math.max(1, Math.round(size / ratio)) : size;
      for (let i = 0; i < this.data.images.length; i += 1) {
        wx.showLoading({ title: `准备图片 ${Math.round(i / this.data.images.length * 100)}%`, mask: true });
        frameIDs.push(await this.prepareFrame(canvas, this.data.images[i], outputWidth, outputHeight, i));
      }
      wx.showLoading({ title: '云端合成中', mask: true });
      this.setData({ generatingText: '云端合成中…' });
      const response = await wx.cloud.callFunction({ name: 'gifImages', data: { action: 'generate', fileIDs: frameIDs, width: outputWidth, height: outputHeight, delay: Math.round(100 / this.data.fps), loop: this.data.loop } });
      if (!response.result || !response.result.success) {
        const result = response.result || {};
        const error = new Error(result.message || '云函数未返回结果');
        error.stage = '云端合成'; error.code = result.errCode;
        throw error;
      }
      wx.showLoading({ title: '下载成品', mask: true });
      const download = await wx.cloud.downloadFile({ fileID: response.result.fileID });
      this.setData({ generatedGif: download.tempFilePath, resultVisible: true });
    } catch (error) {
      console.error('generateGif failed', error);
      const raw = String(error.errMsg || error.message || '未知错误');
      const isCloudTimeout = /-504003|timed out|time.limit|FUNCTIONS_TIME_LIMIT/i.test(raw);
      const friendly = raw.includes('FunctionName') || raw.includes('function') && raw.includes('not')
        ? '未找到 gifImages 云函数，请先在微信开发者工具中上传并部署该云函数（选择云端安装依赖）。'
        : isCloudTimeout ? 'gifImages 云函数仍使用平台默认的 3 秒超时。请进入云开发控制台 → 云函数 → gifImages → 函数配置，将超时时间改为 60 秒（建议同时将内存设为 512MB），保存后再重试。仅重新上传代码不会修改这个配置。'
        : raw.includes('memory') ? '云函数内存不足，请降低输出分辨率后重试。'
        : raw;
      wx.showModal({ title: `${error.stage || '生成'}失败${error.code ? `（${error.code}）` : ''}`, content: friendly.slice(0, 500), showCancel: false, confirmText: '知道了' });
    } finally {
      if (frameIDs.length) wx.cloud.deleteFile({ fileList: frameIDs }).catch(() => {});
      wx.hideLoading(); this.setData({ generating: false, generatingText: '' });
    }
  },
  closeResult() { this.setData({ resultVisible: false }); },
  saveGeneratedGif() {
    if (!this.data.generatedGif) return;
    wx.saveImageToPhotosAlbum({ filePath: this.data.generatedGif, success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }), fail: error => {
      if (String(error.errMsg).includes('auth deny')) wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存图片到相册', success: r => r.confirm && wx.openSetting() });
      else wx.showToast({ title: '保存失败', icon: 'none' });
    }});
  }
});
