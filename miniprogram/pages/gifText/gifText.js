Page({
  data: {
    gifPath: '', auditFileID: '', sourceWidth: 1, sourceHeight: 1, stageHeight: 372, stageWidthPx: 1, stageHeightPx: 1,
    text: '哦哦哦', textX: 80, textY: 100, textScale: 1, fontSize: 26, textColor: '#FFFFFF', bold: false,
    strokeOn: true, strokeColor: '#000000', strokeWidth: 3, strokeStyle: '', generating: false, generatedGif: '', resultVisible: false,
    colors: ['#FFFFFF','#000000','#EF4444','#F97316','#FACC15','#22C55E','#3B82F6','#A855F7'], strokeColors: ['#FFFFFF','#000000','#EF4444','#FACC15','#22C55E','#3B82F6']
  },
  onLoad() { this.refreshStroke(); },
  onUnload() { this.cleanup(); },
  goBack() { wx.navigateBack(); }, wait(ms) { return new Promise(r => setTimeout(r, ms)); },
  async audit(fileID) {
    let last;
    for (let i = 1; i <= 2; i += 1) { try { const r = await wx.cloud.callFunction({ name: 'gifImages', data: { action: 'audit', fileID, contentType: 'image/png' } }); if (r.result && (r.result.success || ['risky','review'].includes(r.result.suggest))) return r.result; last = new Error((r.result && r.result.message) || '审核服务不可用'); } catch (e) { last = e; } if (i < 2) await this.wait(300); }
    throw last;
  },
  loadCanvasImage(canvas, src) { return new Promise((resolve, reject) => { const image = canvas.createImage(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; }); },
  async createAuditPreview(filePath, info) {
    const canvas = await this.getCanvas();
    const scale = Math.min(1, 480 / Math.max(info.width, info.height));
    const width = Math.max(1, Math.round(info.width * scale)); const height = Math.max(1, Math.round(info.height * scale));
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); const image = await this.loadCanvasImage(canvas, filePath);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0, width, height);
    return new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, fileType: 'png', destWidth: width, destHeight: height, success: r => resolve(r.tempFilePath), fail: reject }));
  },
  async chooseGif() {
    try {
      const source = await new Promise((resolve, reject) => wx.showActionSheet({ itemList: ['从相册选择', '从聊天记录选择'], success: r => resolve(r.tapIndex), fail: reject }));
      let file;
      if (source === 0) {
        const r = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'], sizeType: ['original'] });
        file = r.tempFiles && r.tempFiles[0];
      } else {
        const r = await wx.chooseMessageFile({ count: 1, type: 'file', extension: ['gif'] });
        file = r.tempFiles && r.tempFiles[0];
      }
      if (!file) return;
      const filePath = file.tempFilePath || file.path || '';
      if (!/\.gif(?:\?|$)/i.test(filePath) && file.fileType !== 'gif' && file.type !== 'image/gif') return wx.showToast({ title: '请选择GIF文件', icon: 'none' });
      wx.showLoading({ title: 'GIF审核中', mask: true });
      const info = await new Promise((resolve, reject) => wx.getImageInfo({ src: filePath, success: resolve, fail: reject }));
      const auditPreview = await this.createAuditPreview(filePath, info);
      const auditUpload = await wx.cloud.uploadFile({ cloudPath: `gif-audit/${Date.now()}-${Math.random().toString(36).slice(2)}.png`, filePath: auditPreview });
      let check;
      try { check = await this.audit(auditUpload.fileID); } finally { await wx.cloud.deleteFile({ fileList: [auditUpload.fileID] }).catch(() => {}); }
      if (!check.success) return wx.showModal({ title: 'GIF未通过审核', content: '微信内容安全接口判定该文件需复审或存在风险。', showCancel: false });
      wx.showLoading({ title: '正在载入GIF', mask: true });
      const up = await wx.cloud.uploadFile({ cloudPath: `gif-text/${Date.now()}-${Math.random().toString(36).slice(2)}.gif`, filePath });
      this.cleanup(); const ratio = info.width / info.height; const stageHeight = Math.max(260, Math.min(620, Math.round(662 / ratio)));
      this.setData({ gifPath: filePath, auditFileID: up.fileID, sourceWidth: info.width, sourceHeight: info.height, stageHeight, textX: 80, textY: Math.round(stageHeight / 3), textScale: 1 }, () => setTimeout(() => this.measureStage(), 50));
    } catch (e) { if (!String(e.errMsg || e.message).includes('cancel')) wx.showModal({ title: '审核服务暂时不可用', content: '本次未判定为违规，请稍后重试。', showCancel: false }); } finally { wx.hideLoading(); }
  },
  measureStage() { this.createSelectorQuery().select('#stage').boundingClientRect(r => r && this.setData({ stageWidthPx: r.width, stageHeightPx: r.height })).exec(); },
  cleanup() { if (this.data.auditFileID) wx.cloud.deleteFile({ fileList: [this.data.auditFileID] }).catch(() => {}); },
  reselect() { this.cleanup(); this.setData({ gifPath: '', auditFileID: '', generatedGif: '', resultVisible: false }); },
  inputText(e) { this.setData({ text: e.detail.value }); }, deleteText() { this.setData({ text: '' }); },
  moveText(e) { if (e.detail.source) this.setData({ textX: e.detail.x, textY: e.detail.y }); }, scaleText(e) { this.setData({ textScale: e.detail.scale }); },
  chooseTextColor(e) { this.setData({ textColor: e.currentTarget.dataset.color }); }, chooseStrokeColor(e) { this.setData({ strokeColor: e.currentTarget.dataset.color }, () => this.refreshStroke()); },
  toggleBold() { this.setData({ bold: !this.data.bold }); }, toggleStroke() { this.setData({ strokeOn: !this.data.strokeOn }, () => this.refreshStroke()); },
  changeStroke(e) { this.setData({ strokeWidth: Number(e.detail.value), strokeOn: Number(e.detail.value) > 0 }, () => this.refreshStroke()); }, changeFontSize(e) { this.setData({ fontSize: Number(e.detail.value) }); },
  refreshStroke() { const d = this.data; this.setData({ strokeStyle: d.strokeOn && d.strokeWidth ? `-webkit-text-stroke:${d.strokeWidth}px ${d.strokeColor};` : '' }); },
  getCanvas() { return new Promise((resolve, reject) => this.createSelectorQuery().select('#textCanvas').fields({ node: true, size: true }).exec(r => r[0] ? resolve(r[0].node) : reject(new Error('canvas unavailable')))); },
  async createOverlay() {
    const canvas = await this.getCanvas(); const w = this.data.sourceWidth; const h = this.data.sourceHeight; canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);
    const scaleX = w / this.data.stageWidthPx; const scaleY = h / this.data.stageHeightPx; const font = this.data.fontSize * this.data.textScale * scaleX;
    ctx.font = `${this.data.bold ? '900' : '600'} ${font}px sans-serif`; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    const lines = this.data.text.split('\n'); const x = this.data.textX * scaleX; const y = this.data.textY * scaleY; const lineHeight = font * 1.2;
    lines.forEach((line, i) => { if (this.data.strokeOn && this.data.strokeWidth) { ctx.strokeStyle = this.data.strokeColor; ctx.lineWidth = this.data.strokeWidth * 2 * scaleX; ctx.strokeText(line, x, y + i * lineHeight); } ctx.fillStyle = this.data.textColor; ctx.fillText(line, x, y + i * lineHeight); });
    return new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, fileType: 'png', destWidth: w, destHeight: h, success: r => resolve(r.tempFilePath), fail: reject }));
  },
  async generate() {
    if (!this.data.text || this.data.generating) return; this.setData({ generating: true }); let overlayID = '';
    try { wx.showLoading({ title: '正在处理', mask: true }); const overlay = await this.createOverlay(); const up = await wx.cloud.uploadFile({ cloudPath: `gif-text-overlays/${Date.now()}.png`, filePath: overlay }); overlayID = up.fileID;
      const r = await wx.cloud.callFunction({ name: 'gifImages', data: { action: 'generateGifText', fileID: this.data.auditFileID, overlayFileID: overlayID } }); if (!r.result || !r.result.success) throw new Error((r.result && r.result.message) || '处理失败');
      const down = await wx.cloud.downloadFile({ fileID: r.result.fileID }); this.setData({ generatedGif: down.tempFilePath, resultVisible: true });
    } catch (e) { wx.showModal({ title: '处理失败', content: String(e.errMsg || e.message).slice(0, 500), showCancel: false }); } finally { if (overlayID) wx.cloud.deleteFile({ fileList: [overlayID] }).catch(() => {}); wx.hideLoading(); this.setData({ generating: false }); }
  },
  closeResult() { this.setData({ resultVisible: false }); }, saveResult() { wx.saveImageToPhotosAlbum({ filePath: this.data.generatedGif, success: () => wx.showToast({ title: '已保存', icon: 'success' }), fail: () => wx.showToast({ title: '保存失败', icon: 'none' }) }); }
});
