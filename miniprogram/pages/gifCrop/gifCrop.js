Page({
  data: {
    path: '', srcWidth: 1280, srcHeight: 720,
    stageWidth: 1, stageHeight: 1,
    ratios: [{ label: '自由', value: 'free' }, { label: '1:1', value: '1:1' }, { label: '9:16', value: '9:16' }, { label: '16:9', value: '16:9' }, { label: '3:4', value: '3:4' }, { label: '4:3', value: '4:3' }, { label: '2:1', value: '2:1' }, { label: '1:2', value: '1:2' }],
    ratio: '9:16', box: { x: 0, y: 0, w: 1, h: 1 }, cropStyle: '', cropText: ''
  },
  onLoad(options) {
    const srcWidth = Math.max(1, Number(options.width) || 1280);
    const srcHeight = Math.max(1, Number(options.height) || 720);
    this.setData({ path: decodeURIComponent(options.path || ''), srcWidth, srcHeight }, () => this.setRatioBox(9 / 16));
  },
  onReady() {
    this.createSelectorQuery().select('#stage').boundingClientRect(rect => {
      if (rect) this.setData({ stageWidth: rect.width, stageHeight: rect.height }, () => this.renderBox());
    }).exec();
  },
  setRatioBox(ratio) {
    const sw = this.data.srcWidth; const sh = this.data.srcHeight;
    const scale = Math.min(sw / ratio, sh);
    const w = scale * ratio; const h = scale;
    this.setData({ box: { x: (sw - w) / 2, y: (sh - h) / 2, w, h } }, () => this.renderBox());
  },
  renderBox() {
    const box = this.data.box; const sw = this.data.srcWidth; const sh = this.data.srcHeight;
    this.setData({
      cropStyle: `left:${box.x / sw * 100}%;top:${box.y / sh * 100}%;width:${box.w / sw * 100}%;height:${box.h / sh * 100}%;`,
      cropText: `${Math.round(box.w)} × ${Math.round(box.h)} (X:${Math.round(box.x)} Y:${Math.round(box.y)})`
    });
  },
  chooseRatio(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ ratio: value });
    if (value === 'free') return;
    const parts = value.split(':');
    this.setRatioBox(Number(parts[0]) / Number(parts[1]));
  },
  touchStart(e) {
    const touch = e.touches[0]; if (!touch) return;
    this.drag = { x: touch.clientX, y: touch.clientY, box: { ...this.data.box } };
  },
  touchMove(e) {
    if (!this.drag || !e.touches[0]) return;
    const touch = e.touches[0]; const start = this.drag; const box = start.box;
    const dx = (touch.clientX - start.x) * this.data.srcWidth / this.data.stageWidth;
    const dy = (touch.clientY - start.y) * this.data.srcHeight / this.data.stageHeight;
    this.setData({ box: {
      ...box,
      x: Math.max(0, Math.min(this.data.srcWidth - box.w, box.x + dx)),
      y: Math.max(0, Math.min(this.data.srcHeight - box.h, box.y + dy))
    } }, () => this.renderBox());
  },
  touchEnd() { this.drag = null; },
  cancel() { wx.navigateBack(); },
  confirm() {
    const box = this.data.box; const sw = this.data.srcWidth; const sh = this.data.srcHeight;
    const channel = this.getOpenerEventChannel();
    channel.emit('cropConfirmed', {
      x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.w), height: Math.round(box.h), ratio: this.data.ratio,
      left: box.x / sw * 100, top: box.y / sh * 100, widthPercent: box.w / sw * 100, heightPercent: box.h / sh * 100
    });
    wx.navigateBack();
  }
});
