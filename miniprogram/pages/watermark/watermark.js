const { ensureLogin } = require('../../utils/auth');
const { consumeUsage } = require('../../utils/usage-quota');

const COLORS = [
  { id: 'black', value: '#000000' }, { id: 'gray', value: '#616266' },
  { id: 'lightGray', value: '#c1c4cb', light: true }, { id: 'white', value: '#ffffff', light: true },
  { id: 'red', value: '#e34a3e' }, { id: 'orange', value: '#ed9f37' },
  { id: 'blue', value: '#5374f6' }, { id: 'green', value: '#59bc73' }
];

Page({
  data: {
    tabs: [{ id: 'text', name: '文本' }, { id: 'style', name: '样式' }, { id: 'angle', name: '倾斜' }, { id: 'density', name: '密度' }, { id: 'mask', name: '蒙板' }],
    colors: COLORS, activeTab: 'text', mode: 'single', imagePath: '', previewWidth: 320, previewHeight: 320,
    text: '仅供网络使用', fontSize: 16, color: '#000000', opacity: 60, angle: -45, horizontalSpace: 80, verticalSpace: 80,
    maskColor: '#ffffff', maskOpacity: 20, watermarkX: 0.5, watermarkY: 0.5, saving: false
  },
  onReady() { const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); this.previewLimit = { width: Math.min(360, info.windowWidth - 28), height: 390 }; },
  goBack() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/moreTools/moreTools' }) }); },
  switchTab(e) { this.setData({ activeTab: e.currentTarget.dataset.id }); },
  inputText(e) { this.setData({ text: e.detail.value.slice(0, 15) }); },
  confirmText() { this.renderPreview(); },
  update(key, e) { this.setData({ [key]: Number(e.detail.value) }, () => this.renderPreview()); },
  changeFontSize(e) { this.update('fontSize', e); }, changeOpacity(e) { this.update('opacity', e); }, changeAngle(e) { this.update('angle', e); },
  changeHorizontalSpace(e) { this.update('horizontalSpace', e); }, changeVerticalSpace(e) { this.update('verticalSpace', e); }, changeMaskOpacity(e) { this.update('maskOpacity', e); },
  selectColor(e) { this.setData({ color: e.currentTarget.dataset.color }, () => this.renderPreview()); },
  selectMaskColor(e) { this.setData({ maskColor: e.currentTarget.dataset.color }, () => this.renderPreview()); },
  async chooseImages() {
    if (this.choosing) return;
    this.choosing = true;
    try {
      const action = await new Promise((resolve, reject) => wx.showActionSheet({ itemList: ['图片加水印（单图直接处理）', '证件照加水印（两张图合成一张）'], success: r => resolve(r.tapIndex), fail: reject }));
      const mode = action === 1 ? 'double' : 'single';
      const selected = await wx.chooseMedia({ count: mode === 'double' ? 2 : 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'] });
      const files = (selected.tempFiles || []).map(item => item.tempFilePath).filter(Boolean);
      if (!files.length) return;
      if (mode === 'double' && files.length < 2) { wx.showToast({ title: '请选择两张图片', icon: 'none' }); return; }
      const infos = await Promise.all(files.slice(0, 2).map(src => new Promise((resolve, reject) => wx.getImageInfo({ src, success: resolve, fail: reject }))));
      this.images = files.slice(0, mode === 'double' ? 2 : 1).map((path, index) => ({ path, width: infos[index].width, height: infos[index].height }));
      this.previewImageCache = null;
      this.setData({ mode, imagePath: this.images[0].path }, () => this.layoutAndRender());
    } catch (error) {
      if (!String(error && error.errMsg || '').includes('cancel')) wx.showToast({ title: '图片选择失败，请重试', icon: 'none' });
    } finally { this.choosing = false; }
  },
  getComposition() {
    const images = this.images || [];
    if (!images.length) return { width: 1, height: 1, entries: [] };
    if (this.data.mode !== 'double' || images.length < 2) return { width: images[0].width, height: images[0].height, entries: [{ image: images[0], x: 0, y: 0, width: images[0].width, height: images[0].height }] };
    const width = Math.max(images[0].width, images[1].width); const gap = Math.max(12, Math.round(width * 0.018));
    const h1 = Math.round(images[0].height * width / images[0].width); const h2 = Math.round(images[1].height * width / images[1].width);
    return { width, height: h1 + gap + h2, entries: [{ image: images[0], x: 0, y: 0, width, height: h1 }, { image: images[1], x: 0, y: h1 + gap, width, height: h2 }], gap };
  },
  layoutAndRender() {
    this.composition = this.getComposition(); const c = this.composition; const ratio = Math.min(this.previewLimit.width / c.width, this.previewLimit.height / c.height, 1);
    this.setData({ previewWidth: Math.max(1, Math.round(c.width * ratio)), previewHeight: Math.max(1, Math.round(c.height * ratio)), watermarkX: 0.5, watermarkY: 0.5 }, () => { this.measurePreview(); this.renderPreview(); });
  },
  measurePreview() { this.createSelectorQuery().select('#previewCanvas').boundingClientRect(rect => { this.previewRect = rect; }).exec(); },
  getCanvas(id) { return new Promise((resolve, reject) => this.createSelectorQuery().select(id).fields({ node: true, size: true }).exec(result => result[0] ? resolve(result[0].node) : reject(new Error('canvas unavailable')))); },
  loadImage(canvas, src) { return new Promise((resolve, reject) => { const image = canvas.createImage(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; }); },
  async getImages(canvas) { if (!this.previewImageCache) this.previewImageCache = await Promise.all((this.images || []).map(item => this.loadImage(canvas, item.path))); return this.previewImageCache; },
  drawWatermark(ctx, width, height, factor) {
    const d = this.data; if (!d.text || !d.opacity) return;
    ctx.save(); ctx.globalAlpha = d.opacity / 100; ctx.fillStyle = d.color; ctx.font = `600 ${Math.max(8, d.fontSize * factor)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.translate(width * d.watermarkX, height * d.watermarkY); ctx.rotate(d.angle * Math.PI / 180);
    const distance = Math.hypot(width, height); const xGap = Math.max(28, d.horizontalSpace * factor); const yGap = Math.max(28, d.verticalSpace * factor);
    for (let y = -distance; y <= distance; y += yGap) for (let x = -distance; x <= distance; x += xGap) ctx.fillText(d.text, x, y);
    ctx.restore();
  },
  async paint(canvas, width, height, factor) {
    const ctx = canvas.getContext('2d'); const images = await this.getImages(canvas); const c = this.composition;
    ctx.clearRect(0, 0, width, height); c.entries.forEach((entry, index) => ctx.drawImage(images[index], entry.x * factor, entry.y * factor, entry.width * factor, entry.height * factor));
    if (this.data.maskOpacity) { ctx.save(); ctx.globalAlpha = this.data.maskOpacity / 100; ctx.fillStyle = this.data.maskColor; ctx.fillRect(0, 0, width, height); ctx.restore(); }
    this.drawWatermark(ctx, width, height, factor);
  },
  async renderPreview() {
    if (!this.data.imagePath) return;
    if (this.rendering) { this.rerenderRequested = true; return; }
    this.rendering = true;
    try { const canvas = await this.getCanvas('#previewCanvas'); const dpr = Math.min(2, (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 1); canvas.width = this.data.previewWidth * dpr; canvas.height = this.data.previewHeight * dpr; await this.paint(canvas, canvas.width, canvas.height, this.data.previewWidth * dpr / this.composition.width); } catch (error) { console.error('watermark preview failed', error); } finally { this.rendering = false; if (this.rerenderRequested) { this.rerenderRequested = false; this.renderPreview(); } }
  },
  touchStart(e) {
    if (!this.data.imagePath || !e.touches[0] || !this.previewRect) return;
    const touch = e.touches[0];
    this.drag = { x: touch.clientX, y: touch.clientY, watermarkX: this.data.watermarkX, watermarkY: this.data.watermarkY };
  },
  touchMove(e) {
    if (!this.drag || !e.touches[0] || !this.previewRect) return;
    const touch = e.touches[0]; const rect = this.previewRect;
    const x = Math.max(0, Math.min(1, this.drag.watermarkX + (touch.clientX - this.drag.x) / rect.width));
    const y = Math.max(0, Math.min(1, this.drag.watermarkY + (touch.clientY - this.drag.y) / rect.height));
    this.setData({ watermarkX: x, watermarkY: y }, () => this.renderPreview());
  },
  touchEnd() { this.drag = null; },
  async saveImage() {
    if (!this.data.imagePath || this.data.saving || this.exporting) return;
    this.exporting = true;
    const user = await ensureLogin();
    if (!user) { this.exporting = false; return; }
    if (!consumeUsage(user)) { this.exporting = false; return; }
    this.setData({ saving: true }); wx.showLoading({ title: '正在生成图片', mask: true });
    try {
      const canvas = await this.getCanvas('#exportCanvas'); const c = this.composition; const maxSide = 4096; const factor = Math.min(1, maxSide / Math.max(c.width, c.height));
      canvas.width = Math.max(1, Math.round(c.width * factor)); canvas.height = Math.max(1, Math.round(c.height * factor)); await this.paint(canvas, canvas.width, canvas.height, factor);
      const filePath = await new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1, destWidth: canvas.width, destHeight: canvas.height, success: result => resolve(result.tempFilePath), fail: reject }));
      await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject })); wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) {
      const message = String(error && (error.errMsg || error.message) || '');
      if (message.includes('auth deny') || message.includes('authorize')) wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存图片到相册。', success: result => result.confirm && wx.openSetting() }); else wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally { wx.hideLoading(); this.setData({ saving: false }); this.exporting = false; }
  }
});
