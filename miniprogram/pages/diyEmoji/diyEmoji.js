const FACES = [
  { name: '黄圆', file: 'yellow-face-base.png', src: '', kind: 'image', composable: true },
  { name: '帽子脸', file: 'face-hat.png', src: '', kind: 'image', composable: true },
  { name: '呕吐脸', file: 'face-vomit.png', src: '', kind: 'image', composable: true },
  { name: '橙圆', file: 'face-orange.png', src: '', kind: 'image', composable: true },
  { name: '蓝金球', file: 'face-blue-gold.png', src: '', kind: 'image', composable: true },
  { name: '小恶魔', file: 'face-devil.png', src: '', kind: 'image', composable: true },
  { name: '猫咪', file: 'face-cat.png', src: '', kind: 'image', composable: true },
  { name: '女生', file: 'face-woman.png', src: '', kind: 'image', composable: true },
  { name: '男生', file: 'face-man.png', src: '', kind: 'image', composable: true },
  { name: '宝宝', file: 'face-baby.png', src: '', kind: 'image', composable: true }
];
const EYE_NAMES = ['豆豆眼','小豆眼','细长眼','弯月眼','点点眼','斜视眼','平静眼','笑眼','眨眼','单眼眨','俏皮眼','侧目眼','低垂眼','无辜眼','委屈眼','困倦眼','忧郁眼','弯弯眼','害羞眼','开心眼','眯眯眼','左弯眼','右弯眼','欢笑眼','撒娇眼','翻白眼','得意眼','微笑眼','叉叉眼','财迷眼'];
const EYES = EYE_NAMES.map((name, index) => ({
  name,
  file: `eyes/eye-${String(index).padStart(2, '0')}.png`,
  src: ''
}));
const PUPILS = ['','●  ●','○  ○','🔴  🔴','🟠  🟠','🟡  🟡','🟢  🟢','🔵  🔵','🟣  🟣','🟤  🟤','⭐  ⭐','❤️  ❤️','💙  💙','💜  💜','💚  💚','💛  💛'].map((glyph, i) => ({ name: i ? `异瞳${i}` : '默认', glyph }));
const MOUTH_NAMES = ['浅笑','抿嘴笑','微笑','露齿笑','灿烂笑','小嘴','平静','波浪嘴','露齿','一字嘴','小一字','紧张嘴','轻抿','弯弧','小弯嘴','撇嘴','委屈','低落','小张嘴','惊讶','大张嘴','竖嘴','咬唇','圆嘴','侧嘴','嘟嘴','露齿微笑','流口水','吐舌','调皮吐舌','舔嘴','财迷嘴','拉链嘴'];
const MOUTHS = MOUTH_NAMES.map((name, index) => ({
  name,
  file: `mouths/mouth-${String(index).padStart(2, '0')}.png`,
  src: ''
}));
const DECO_GLYPHS = ['✨','👉','☝️','👋','👌','👃','🦴','•','💧','💦','🪽','🧢','😷','🌪️','🎉','🕶️','👓','🪢','❤️','💨','😇','📌','💤','🤬','✊','🤝','🙌','👑','🎩','🎓','🎀','🌈','🌸','🍀','🔥','⚡','⭐','💔','❓','❗','💋','🎶','💫','✌️','🫰','🤙','👍','👏'].map((glyph, i) => ({ name: `装饰${i + 1}`, glyph, slot: i % 8 }));
const CATEGORIES = ['脸型','眼睛','异瞳','嘴巴','装饰'];
const HINTS = ['好的emoji表情从选择一个脸型开始','眼睛是心灵的窗户','异色双瞳，一眼万年的灵魂','笑口常开','装饰当然是越多越好'];
const DEFAULT_STATE = { face: 0, eyes: 1, pupil: 0, mouth: 0, decorations: [] };

Page({
  data: {
    categories: CATEGORIES,
    category: 0,
    hint: HINTS[0],
    state: { ...DEFAULT_STATE },
    currentFace: FACES[0],
    currentEyes: EYES[1],
    currentPupil: PUPILS[0],
    currentMouth: MOUTHS[0],
    selectedDecorations: [],
    materials: [],
    canUndo: false,
    saving: false,
    facesLoading: true
  },

  onLoad(query) {
    this.history = [];
    if (query.state) {
      try {
        const incoming = JSON.parse(decodeURIComponent(query.state));
        this.state = this.normalizeState(incoming);
      } catch (_) { this.state = { ...DEFAULT_STATE, decorations: [] }; }
    } else this.state = { ...DEFAULT_STATE, decorations: [] };
    this.refresh();
    this.loadFaceAssets();
  },

  async loadFaceAssets() {
    const fs = wx.getFileSystemManager();
    const version = 'diy-assets-v4';
    const downloadableAssets = FACES.concat(EYES, MOUTHS);
    const localPaths = {};
    let cacheReady = true;
    downloadableAssets.forEach(asset => {
      const filePath = `${wx.env.USER_DATA_PATH}/${version}-${asset.file.replace(/\//g, '-')}`;
      localPaths[asset.file] = filePath;
      try { fs.accessSync(filePath); } catch (_) { cacheReady = false; }
    });
    try {
      if (!cacheReady) {
        const pending = downloadableAssets.filter(asset => {
          try { fs.accessSync(localPaths[asset.file]); return false; } catch (_) { return true; }
        });
        let cursor = 0;
        const worker = async () => {
          while (cursor < pending.length) {
            const asset = pending[cursor++];
            const { result } = await wx.cloud.callFunction({ name: 'diyAssets', data: { file: asset.file } });
            if (!result || !result.success || !result.data) throw new Error(result && result.message || `${asset.name}素材不可用`);
            try { fs.unlinkSync(localPaths[asset.file]); } catch (_) {}
            fs.writeFileSync(localPaths[asset.file], result.data, 'base64');
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
      }
      downloadableAssets.forEach(asset => { asset.src = localPaths[asset.file]; });
      this.setData({ facesLoading: false }, () => this.refresh());
    } catch (error) {
      console.error('load DIY face assets failed', error);
      this.setData({ facesLoading: false });
      wx.showModal({
        title: 'DIY 素材加载失败',
        content: `${error.message || '未知错误'}。请重新部署 diyAssets 云函数后重试。`,
        showCancel: false
      });
    }
  },

  normalizeState(value) {
    const nullableIndex = (candidate, length) => candidate === null || candidate === undefined
      ? null
      : Math.max(0, Math.min(Number(candidate) || 0, length - 1));
    return {
      face: Math.max(0, Math.min(Number(value.face) || 0, FACES.length - 1)),
      eyes: nullableIndex(value.eyes, EYES.length),
      pupil: nullableIndex(value.pupil, PUPILS.length),
      mouth: nullableIndex(value.mouth, MOUTHS.length),
      decorations: Array.isArray(value.decorations) ? value.decorations.filter(i => DECO_GLYPHS[i]).slice(0, 8) : []
    };
  },

  getSource() {
    return [FACES, EYES, PUPILS, MOUTHS, DECO_GLYPHS][this.data.category];
  },

  refresh() {
    const state = this.state;
    const source = this.getSource();
    const materials = source.map((item, index) => ({
      ...item,
      selected: this.data.category === 4 ? state.decorations.includes(index) : [state.face, state.eyes, state.pupil, state.mouth][this.data.category] === index
    }));
    this.setData({
      state: { ...state, decorations: state.decorations.slice() },
      materials,
      currentFace: FACES[state.face],
      currentEyes: state.eyes == null ? null : EYES[state.eyes],
      currentPupil: state.pupil == null ? null : PUPILS[state.pupil],
      currentMouth: state.mouth == null ? null : MOUTHS[state.mouth],
      selectedDecorations: state.decorations.map(index => DECO_GLYPHS[index]),
      canUndo: this.history.length > 0
    });
  },

  switchCategory(e) {
    const category = Number(e.currentTarget.dataset.index);
    this.setData({ category, hint: HINTS[category] }, () => this.refresh());
  },

  snapshot() {
    this.history.push(JSON.stringify(this.state));
    if (this.history.length > 40) this.history.shift();
  },

  chooseMaterial(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.snapshot();
    if (this.data.category === 0) this.state.face = index;
    else if (this.data.category === 1) this.state.eyes = this.state.eyes === index ? null : index;
    else if (this.data.category === 2) this.state.pupil = this.state.pupil === index ? null : index;
    else if (this.data.category === 3) this.state.mouth = this.state.mouth === index ? null : index;
    else {
      const at = this.state.decorations.indexOf(index);
      if (at >= 0) this.state.decorations.splice(at, 1);
      else if (this.state.decorations.length < 8) this.state.decorations.push(index);
      else {
        this.history.pop();
        wx.showToast({ title: '最多添加 8 个装饰', icon: 'none' });
      }
    }
    this.refresh();
  },

  reset() {
    this.snapshot();
    this.state = { ...DEFAULT_STATE, decorations: [] };
    this.refresh();
    wx.showToast({ title: '已重置', icon: 'none' });
  },

  undo() {
    if (!this.history.length) return;
    this.state = JSON.parse(this.history.pop());
    this.refresh();
  },

  goBack() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/moreTools/moreTools' }) }); },
  goMoreTools() { wx.redirectTo({ url: '/pages/moreTools/moreTools' }); },
  goMixer() { wx.redirectTo({ url: '/pages/emojiMixer/emojiMixer' }); },

  loadCanvasImage(canvas, src) {
    return new Promise((resolve, reject) => {
      const image = canvas.createImage();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  },

  async save() {
    if (this.data.saving || this.data.facesLoading || !FACES[this.state.face].src) {
      if (!this.data.saving) wx.showToast({ title: '脸型素材仍在加载', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: '正在保存' });
    try {
      const result = await new Promise((resolve, reject) => this.createSelectorQuery().select('#exportCanvas').fields({ node: true, size: true }).exec(items => items[0] ? resolve(items[0]) : reject(new Error('canvas unavailable'))));
      const canvas = result.node;
      const size = 640;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, size, size);
      const face = FACES[this.state.face];
      if (face.kind === 'image') {
        const image = await this.loadCanvasImage(canvas, face.src);
        ctx.drawImage(image, 24, 24, size - 48, size - 48);
      } else {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '560px sans-serif';
        ctx.fillText(face.glyph, size / 2, size / 2 + 18);
      }
      if (face.composable) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#855511';
        if (this.state.eyes != null) {
          const eyeImage = await this.loadCanvasImage(canvas, EYES[this.state.eyes].src);
          ctx.drawImage(eyeImage, 192, 202, 92, 92);
          ctx.save(); ctx.translate(804, 0); ctx.scale(-1, 1); ctx.drawImage(eyeImage, 356, 202, 92, 92); ctx.restore();
        }
        if (this.state.pupil != null && PUPILS[this.state.pupil].glyph) { ctx.fillStyle = '#111'; ctx.font = '54px sans-serif'; ctx.fillText(PUPILS[this.state.pupil].glyph, size / 2, 256); }
        if (this.state.mouth != null) {
          const mouthImage = await this.loadCanvasImage(canvas, MOUTHS[this.state.mouth].src);
          ctx.drawImage(mouthImage, 220, 330, 200, 160);
        }
      }
      const positions = [[320,56],[110,110],[530,110],[72,270],[568,270],[320,552],[110,520],[530,520]];
      ctx.font = '112px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      this.state.decorations.forEach(index => { const item = DECO_GLYPHS[index]; const p = positions[item.slot]; ctx.fillText(item.glyph, p[0], p[1]); });
      const filePath = await new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, fileType: 'png', destWidth: size, destHeight: size, success: r => resolve(r.tempFilePath), fail: reject }));
      await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject }));
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) {
      const message = error && error.errMsg ? error.errMsg : '';
      if (message.includes('auth deny') || message.includes('authorize')) wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存图片到相册', success: r => r.confirm && wx.openSetting() });
      else { console.error('save DIY emoji failed', error); wx.showToast({ title: '保存失败，请重试', icon: 'none' }); }
    } finally {
      wx.hideLoading(); this.setData({ saving: false });
    }
  },

  onShareAppMessage() {
    return { title: '看看我 DIY 的专属表情', path: `/pages/diyEmoji/diyEmoji?state=${encodeURIComponent(JSON.stringify(this.state))}` };
  }
});
