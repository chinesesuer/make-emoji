const SHAPES = [
  { id: 'square', name: '方形', icon: '■' },
  { id: 'circle', name: '圆形', icon: '●' },
  { id: 'bear', name: '熊头', icon: '🐻', mask: '/assets/grid/mask-bear.png' },
  { id: 'heart', name: '爱心', icon: '♥', mask: '/assets/grid/mask-heart.png' },
  { id: 'flower', name: '花朵', icon: '✿', mask: '/assets/grid/mask-flower.png' }
];

const MORE_SHAPES = [
  { id: 'rounded', name: '圆角', icon: '▣' },
  { id: 'star', name: '星形', icon: '★' },
  { id: 'hex', name: '六边形', icon: '⬡' },
  { id: 'rabbit', name: '兔兔', icon: '🐰' },
  { id: 'cat', name: '猫咪', icon: '🐱' },
  { id: 'pig', name: '猪猪', icon: '🐷' },
  { id: 'frog', name: '青蛙', icon: '🐸' },
  { id: 'dog', name: '狗狗', icon: '🐶' },
  { id: 'panda', name: '熊猫', icon: '🐼' },
  { id: 'monkey', name: '猴子', icon: '🐵' },
  { id: 'mouse', name: '老鼠', icon: '🐭' },
  { id: 'koala', name: '考拉', icon: '🐨' }
];

const GRIDS = [
  { id: '3x3', rows: 3, cols: 3, count: 9 },
  { id: '2x3', rows: 2, cols: 3, count: 6 },
  { id: '1x3', rows: 1, cols: 3, count: 3 },
  { id: '2x2', rows: 2, cols: 2, count: 4 },
  { id: '1x2', rows: 1, cols: 2, count: 2 },
  { id: '3x2', rows: 3, cols: 2, count: 6 }
];

const GAP = 6;
const EXPORT_TILE = 600;

Page({
  data: {
    shapes: SHAPES,
    allShapes: SHAPES.concat(MORE_SHAPES),
    grids: GRIDS,
    shape: 'square',
    grid: '3x3',
    count: 9,
    imagePath: '',
    previewWidth: 320,
    previewHeight: 320,
    drawerVisible: false,
    resultVisible: false,
    tiles: [],
    generating: false,
    saving: false
  },

  onReady() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.previewBox = Math.min(360, info.windowWidth - 32);
    this.position = { x: 0.5, y: 0.5 };
    this.renderPreview();
  },

  getGrid() {
    return GRIDS.find(item => item.id === this.data.grid) || GRIDS[0];
  },

  getLayout(box) {
    const grid = this.getGrid();
    const cell = Math.min((box - (grid.cols - 1) * GAP) / grid.cols, (box - (grid.rows - 1) * GAP) / grid.rows);
    return {
      rows: grid.rows,
      cols: grid.cols,
      cell,
      width: grid.cols * cell + (grid.cols - 1) * GAP,
      height: grid.rows * cell + (grid.rows - 1) * GAP
    };
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/moreTools/moreTools' }) });
  },

  goCreate() { wx.redirectTo({ url: '/pages/index/index' }); },
  goGifTools() { wx.redirectTo({ url: '/pages/gifTools/gifTools' }); },
  goMoreTools() { wx.redirectTo({ url: '/pages/moreTools/moreTools' }); },
  goProfile() { wx.redirectTo({ url: '/pages/profile/profile' }); },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],
      success: result => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) return;
        wx.getImageInfo({
          src: file.tempFilePath,
          success: info => {
            this.sourceInfo = { width: info.width, height: info.height };
            this.position = { x: 0.5, y: 0.5 };
            this.previewImage = null;
            this.setData({ imagePath: file.tempFilePath, tiles: [], resultVisible: false }, () => this.renderPreview());
          },
          fail: () => wx.showToast({ title: '图片读取失败', icon: 'none' })
        });
      }
    });
  },

  selectShape(e) {
    this.setData({ shape: e.currentTarget.dataset.id, drawerVisible: false }, () => this.renderPreview());
  },

  selectGrid(e) {
    const id = e.currentTarget.dataset.id;
    const grid = GRIDS.find(item => item.id === id) || GRIDS[0];
    this.position = { x: 0.5, y: 0.5 };
    this.setData({ grid: id, count: grid.count }, () => this.renderPreview());
  },

  openDrawer() { this.setData({ drawerVisible: true }); },
  closeDrawer() { this.setData({ drawerVisible: false }); },
  stopTap() {},
  closeResult() { this.setData({ resultVisible: false }); },

  loadCanvasImage(canvas, src) {
    return new Promise((resolve, reject) => {
      const image = canvas.createImage();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  },

  getMaskPath(shape) {
    const item = SHAPES.concat(MORE_SHAPES).find(value => value.id === shape);
    return item && item.mask || '';
  },

  async loadMaskImage(canvas, shape, cache) {
    const path = this.getMaskPath(shape);
    if (!path) return null;
    this.maskCache = this.maskCache || {};
    if (cache && this.maskCache[shape]) return this.maskCache[shape];
    const image = await this.loadCanvasImage(canvas, path);
    if (cache) this.maskCache[shape] = image;
    return image;
  },

  async getPreviewCanvas() {
    if (this.previewCanvas) return this.previewCanvas;
    return new Promise((resolve, reject) => {
      this.createSelectorQuery().select('#previewCanvas').fields({ node: true, size: true }).exec(items => {
        if (!items[0]) return reject(new Error('preview canvas unavailable'));
        this.previewCanvas = items[0].node;
        resolve(this.previewCanvas);
      });
    });
  },

  async renderPreview() {
    if (!this.previewBox) return;
    const layout = this.getLayout(this.previewBox);
    this.setData({ previewWidth: layout.width, previewHeight: layout.height });
    try {
      const canvas = await this.getPreviewCanvas();
      const dpr = Math.min(2, (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 1);
      canvas.width = Math.round(layout.width * dpr);
      canvas.height = Math.round(layout.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, layout.width, layout.height);
      if (!this.data.imagePath) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, layout.width, layout.height);
        ctx.fillStyle = '#a0a8b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '15px sans-serif';
        ctx.fillText('请选择一张图片', layout.width / 2, layout.height / 2);
        this.drawGrid(ctx, layout, '#ffffff', 4);
        return;
      }
      if (!this.previewImage) this.previewImage = await this.loadCanvasImage(canvas, this.data.imagePath);
      const maskImage = await this.loadMaskImage(canvas, this.data.shape, true);
      this.paint(ctx, layout, this.previewImage, maskImage);
    } catch (error) {
      console.error('render grid preview failed', error);
    }
  },

  traceShape(ctx, shape, width, height) {
    const cx = width / 2; const cy = height / 2; const r = Math.min(width, height) / 2;
    ctx.beginPath();
    if (shape === 'square') ctx.rect(0, 0, width, height);
    else if (shape === 'rounded') {
      const radius = Math.min(width, height) * 0.12;
      ctx.moveTo(radius, 0); ctx.lineTo(width - radius, 0); ctx.quadraticCurveTo(width, 0, width, radius);
      ctx.lineTo(width, height - radius); ctx.quadraticCurveTo(width, height, width - radius, height);
      ctx.lineTo(radius, height); ctx.quadraticCurveTo(0, height, 0, height - radius);
      ctx.lineTo(0, radius); ctx.quadraticCurveTo(0, 0, radius, 0);
    } else if (shape === 'circle') ctx.arc(cx, cy, r, 0, Math.PI * 2);
    else if (shape === 'heart') {
      ctx.moveTo(cx, height * 0.27);
      ctx.bezierCurveTo(width * 0.42, height * 0.08, width * 0.28, height * 0.03, width * 0.17, height * 0.12);
      ctx.bezierCurveTo(-width * 0.02, height * 0.28, width * 0.03, height * 0.55, width * 0.15, height * 0.69);
      ctx.bezierCurveTo(width * 0.25, height * 0.81, width * 0.39, height * 0.9, cx, height * 0.98);
      ctx.bezierCurveTo(width * 0.61, height * 0.9, width * 0.75, height * 0.81, width * 0.85, height * 0.69);
      ctx.bezierCurveTo(width * 0.97, height * 0.55, width * 1.02, height * 0.28, width * 0.83, height * 0.12);
      ctx.bezierCurveTo(width * 0.72, height * 0.03, width * 0.58, height * 0.08, cx, height * 0.27);
    } else if (shape === 'star') {
      for (let i = 0; i < 10; i += 1) {
        const angle = -Math.PI / 2 + i * Math.PI / 5; const rr = i % 2 ? r * 0.46 : r * 0.96;
        const x = cx + Math.cos(angle) * rr; const y = cy + Math.sin(angle) * rr;
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else if (shape === 'hex') {
      for (let i = 0; i < 6; i += 1) {
        const a = Math.PI / 6 + i * Math.PI / 3; const x = cx + Math.cos(a) * r; const y = cy + Math.sin(a) * r;
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else if (shape === 'flower') {
      const point = (angle, radius) => ({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
      const first = point(-Math.PI / 2 - Math.PI / 6, r * 0.2);
      ctx.moveTo(first.x, first.y);
      for (let i = 0; i < 6; i += 1) {
        const angle = -Math.PI / 2 + i * Math.PI / 3;
        const c1 = point(angle - 0.46, r * 0.5); const c2 = point(angle - 0.25, r * 0.91); const tip = point(angle, r * 0.98);
        const c3 = point(angle + 0.25, r * 0.91); const c4 = point(angle + 0.46, r * 0.5); const valley = point(angle + Math.PI / 6, r * 0.2);
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, tip.x, tip.y);
        ctx.bezierCurveTo(c3.x, c3.y, c4.x, c4.y, valley.x, valley.y);
      }
    } else if (shape === 'bear') {
      ctx.moveTo(width * 0.18, height * 0.28);
      ctx.bezierCurveTo(width * 0.06, height * 0.18, width * 0.05, height * 0.02, width * 0.18, 0);
      ctx.bezierCurveTo(width * 0.29, -height * 0.02, width * 0.36, height * 0.08, width * 0.38, height * 0.17);
      ctx.bezierCurveTo(width * 0.46, height * 0.13, width * 0.54, height * 0.13, width * 0.62, height * 0.17);
      ctx.bezierCurveTo(width * 0.64, height * 0.08, width * 0.71, -height * 0.02, width * 0.82, 0);
      ctx.bezierCurveTo(width * 0.95, height * 0.02, width * 0.94, height * 0.18, width * 0.82, height * 0.28);
      ctx.bezierCurveTo(width * 0.95, height * 0.44, width * 0.97, height * 0.67, width * 0.86, height * 0.82);
      ctx.bezierCurveTo(width * 0.74, height * 0.97, width * 0.6, height, cx, height);
      ctx.bezierCurveTo(width * 0.4, height, width * 0.26, height * 0.97, width * 0.14, height * 0.82);
      ctx.bezierCurveTo(width * 0.03, height * 0.67, width * 0.05, height * 0.44, width * 0.18, height * 0.28);
    } else {
      const ear = shape === 'rabbit' ? height * 0.3 : height * 0.16;
      ctx.moveTo(width * 0.18, height * 0.28);
      ctx.quadraticCurveTo(width * 0.08, -ear, width * 0.34, height * 0.16);
      ctx.quadraticCurveTo(cx, height * 0.04, width * 0.66, height * 0.16);
      ctx.quadraticCurveTo(width * 0.92, -ear, width * 0.82, height * 0.28);
      ctx.quadraticCurveTo(width, height * 0.52, width * 0.8, height * 0.84);
      ctx.quadraticCurveTo(cx, height, width * 0.2, height * 0.84);
      ctx.quadraticCurveTo(0, height * 0.52, width * 0.18, height * 0.28);
    }
    ctx.closePath();
  },

  placement(layout) {
    const source = this.sourceInfo || { width: 1, height: 1 };
    const scale = Math.max(layout.width / source.width, layout.height / source.height);
    const drawWidth = source.width * scale; const drawHeight = source.height * scale;
    const overflowX = Math.max(0, drawWidth - layout.width); const overflowY = Math.max(0, drawHeight - layout.height);
    return { drawWidth, drawHeight, overflowX, overflowY, x: -this.position.x * overflowX, y: -this.position.y * overflowY };
  },

  drawGrid(ctx, layout, color, width) {
    ctx.fillStyle = color;
    for (let col = 1; col < layout.cols; col += 1) ctx.fillRect(layout.cell * col + GAP * (col - 1), 0, GAP, layout.height);
    for (let row = 1; row < layout.rows; row += 1) ctx.fillRect(0, layout.cell * row + GAP * (row - 1), layout.width, GAP);
    if (width) {
      ctx.strokeStyle = 'rgba(255,255,255,.82)'; ctx.lineWidth = width;
      this.traceShape(ctx, this.data.shape, layout.width, layout.height); ctx.stroke();
    }
  },

  paint(ctx, layout, image, maskImage) {
    const p = this.placement(layout);
    ctx.save();
    if (!maskImage) {
      this.traceShape(ctx, this.data.shape, layout.width, layout.height);
      ctx.clip();
    }
    ctx.drawImage(image, p.x, p.y, p.drawWidth, p.drawHeight);
    this.drawGrid(ctx, layout, '#ffffff', 0);
    if (maskImage) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(maskImage, 0, 0, layout.width, layout.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  },

  touchStart(e) {
    if (!this.data.imagePath || !e.touches[0]) return;
    const layout = this.getLayout(this.previewBox); const p = this.placement(layout); const t = e.touches[0];
    this.drag = { x: t.clientX, y: t.clientY, px: this.position.x, py: this.position.y, overflowX: p.overflowX, overflowY: p.overflowY };
  },

  touchMove(e) {
    if (!this.drag || !e.touches[0]) return;
    const t = e.touches[0]; const d = this.drag;
    if (d.overflowX > 1) this.position.x = Math.max(0, Math.min(1, d.px - (t.clientX - d.x) / d.overflowX));
    if (d.overflowY > 1) this.position.y = Math.max(0, Math.min(1, d.py - (t.clientY - d.y) / d.overflowY));
    this.renderPreview();
  },

  touchEnd() { this.drag = null; },

  async generateTiles() {
    if (!this.data.imagePath) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }
    if (this.data.generating) return;
    this.setData({ generating: true });
    wx.showLoading({ title: '正在切图' });
    try {
      const result = await new Promise((resolve, reject) => this.createSelectorQuery().select('#exportCanvas').fields({ node: true, size: true }).exec(items => items[0] ? resolve(items[0].node) : reject(new Error('export canvas unavailable'))));
      const canvas = result; const layout = this.getLayout(this.previewBox); const factor = EXPORT_TILE / layout.cell;
      const width = Math.round(layout.width * factor); const height = Math.round(layout.height * factor);
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); ctx.setTransform(factor, 0, 0, factor, 0, 0); ctx.clearRect(0, 0, layout.width, layout.height);
      const image = await this.loadCanvasImage(canvas, this.data.imagePath);
      const maskImage = await this.loadMaskImage(canvas, this.data.shape, false);
      this.paint(ctx, layout, image, maskImage);
      const step = Math.round((layout.cell + GAP) * factor); const tileSize = Math.round(layout.cell * factor); const tiles = [];
      for (let row = 0; row < layout.rows; row += 1) {
        for (let col = 0; col < layout.cols; col += 1) {
          const file = await new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, x: col * step, y: row * step, width: tileSize, height: tileSize, destWidth: EXPORT_TILE, destHeight: EXPORT_TILE, fileType: 'png', quality: 1, success: value => resolve(value.tempFilePath), fail: reject }));
          tiles.push({ path: file, number: tiles.length + 1 });
        }
      }
      this.setData({ tiles, resultVisible: true });
    } catch (error) {
      console.error('generate grid slices failed', error);
      wx.showToast({ title: '切图失败，请重试', icon: 'none' });
    } finally {
      wx.hideLoading(); this.setData({ generating: false });
    }
  },

  async saveAll() {
    if (!this.data.tiles.length || this.data.saving) return;
    this.setData({ saving: true }); wx.showLoading({ title: `保存 0/${this.data.tiles.length}` });
    try {
      for (let i = 0; i < this.data.tiles.length; i += 1) {
        wx.showLoading({ title: `保存 ${i + 1}/${this.data.tiles.length}` });
        await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath: this.data.tiles[i].path, success: resolve, fail: reject }));
      }
      wx.hideLoading(); wx.showModal({ title: '保存成功', content: `已按顺序保存 ${this.data.tiles.length} 张切片，发布朋友圈时请按顺序选择。`, showCancel: false });
    } catch (error) {
      wx.hideLoading();
      const message = error && error.errMsg || '';
      if (message.includes('auth deny') || message.includes('authorize')) wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存图片到相册', success: value => value.confirm && wx.openSetting() });
      else wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
