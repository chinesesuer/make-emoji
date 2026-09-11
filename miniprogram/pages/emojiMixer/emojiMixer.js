const POOL = ['😀','😂','😍','🥰','😎','🤔','😴','🤯','🥳','😭','😡','🤗','😋','🤪','😇','🥺','😱','🤢','😷','🤠','😵','😆','😉','😊','🙃','😜','😘','😚','😙','😗','😢','😩','😣','😖','😫','🥹'];
const DATES = ['20201001', '20210831', '20220506', '20230221'];
const BASE_URL = 'https://www.gstatic.com/android/keyboard/emojikitchen/';

function codePoints(emoji) {
  return Array.from(emoji).map(char => `u${char.codePointAt(0).toString(16).toLowerCase()}`).join('-');
}

function kitchenUrl(date, left, right) {
  const first = codePoints(left);
  return `${BASE_URL}${date}/${first}/${first}_${codePoints(right)}.png`;
}

function shuffledPool() {
  const list = POOL.slice();
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, 12);
}

Page({
  data: {
    leftList: ['😩','😢','😣','😭','🥺','😖','😫','🥹','😰','😥','😔','😞'],
    rightList: ['🤩','😗','😙','😘','😚','😆','😉','😊','🙃','😜','😋','🤗'],
    leftIndex: 1,
    rightIndex: 1,
    leftEmoji: '😢',
    rightEmoji: '😗',
    leftScrollTop: 0,
    rightScrollTop: 0,
    candidateSrc: '',
    resultType: 'loading',
    saving: false
  },

  onLoad(query) {
    this.itemHeight = 128 * wx.getSystemInfoSync().windowWidth / 750;
    const updates = {
      leftScrollTop: this.itemHeight,
      rightScrollTop: this.itemHeight
    };
    if (query.left && query.right) {
      const left = decodeURIComponent(query.left);
      const right = decodeURIComponent(query.right);
      updates.leftList = [POOL[0], left, ...POOL.filter(item => item !== left).slice(0, 10)];
      updates.rightList = [POOL[1], right, ...POOL.filter(item => item !== right).slice(0, 10)];
      updates.leftEmoji = left;
      updates.rightEmoji = right;
    }
    this.setData(updates, () => this.startProbe());
  },

  onUnload() {
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/moreTools/moreTools' }) });
  },

  selectItem(e) {
    const { side, index } = e.currentTarget.dataset;
    this.applySelection(side, Number(index), true);
  },

  onColumnScroll(e) {
    const side = e.currentTarget.dataset.side;
    const index = Math.round(e.detail.scrollTop / this.itemHeight);
    const list = this.data[`${side}List`];
    const safeIndex = Math.max(0, Math.min(index, list.length - 1));
    const key = `${side}Index`;
    if (safeIndex !== this.data[key]) {
      this.setData({ [key]: safeIndex, [`${side}Emoji`]: list[safeIndex] });
    }
    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => this.finishScroll(side), 140);
  },

  onColumnScrollEnd(e) {
    this.finishScroll(e.currentTarget.dataset.side);
  },

  finishScroll(side) {
    const index = this.data[`${side}Index`];
    this.setData({ [`${side}ScrollTop`]: index * this.itemHeight }, () => this.startProbe());
  },

  applySelection(side, index, probe) {
    const list = this.data[`${side}List`];
    const safeIndex = Math.max(0, Math.min(index, list.length - 1));
    this.setData({
      [`${side}Index`]: safeIndex,
      [`${side}Emoji`]: list[safeIndex],
      [`${side}ScrollTop`]: safeIndex * this.itemHeight
    }, () => probe && this.startProbe());
  },

  roll(e) {
    const side = e.currentTarget.dataset.side;
    const list = shuffledPool();
    const index = 4 + Math.floor(Math.random() * 5);
    this.setData({
      [`${side}List`]: list,
      [`${side}Index`]: index,
      [`${side}Emoji`]: list[index],
      [`${side}ScrollTop`]: index * this.itemHeight
    }, () => this.startProbe());
  },

  startProbe() {
    const { leftEmoji, rightEmoji } = this.data;
    this.candidates = [];
    DATES.forEach(date => {
      this.candidates.push(kitchenUrl(date, leftEmoji, rightEmoji));
      this.candidates.push(kitchenUrl(date, rightEmoji, leftEmoji));
    });
    this.candidateIndex = 0;
    this.setData({ resultType: 'loading', candidateSrc: this.candidates[0] });
  },

  onCandidateLoad(e) {
    if (e.currentTarget.dataset.url !== this.data.candidateSrc) return;
    this.setData({ resultType: 'official' });
  },

  onCandidateError(e) {
    if (e.currentTarget.dataset.url !== this.data.candidateSrc) return;
    this.candidateIndex += 1;
    if (this.candidateIndex >= this.candidates.length) {
      this.setData({ candidateSrc: '', resultType: 'fallback' });
      return;
    }
    this.setData({ candidateSrc: this.candidates[this.candidateIndex] });
  },

  async saveEmoji() {
    if (this.data.saving || this.data.resultType === 'loading') return;
    this.setData({ saving: true });
    wx.showLoading({ title: '正在保存' });
    try {
      const filePath = this.data.resultType === 'official'
        ? await this.downloadOfficialImage()
        : await this.renderFallbackImage();
      await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject }));
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) {
      const message = error && error.errMsg ? error.errMsg : '';
      if (message.includes('auth deny') || message.includes('authorize')) {
        wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存图片到相册', success: result => result.confirm && wx.openSetting() });
      } else {
        console.error('save emoji failed', error);
        wx.showToast({ title: '保存失败，请检查网络', icon: 'none' });
      }
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },

  downloadOfficialImage() {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: this.data.candidateSrc,
        success: result => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error(`HTTP ${result.statusCode}`)),
        fail: reject
      });
    });
  },

  renderFallbackImage() {
    return new Promise((resolve, reject) => {
      this.createSelectorQuery().select('#fallbackCanvas').fields({ node: true, size: true }).exec(results => {
        if (!results[0] || !results[0].node) return reject(new Error('canvas unavailable'));
        const canvas = results[0].node;
        const size = 512;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '440px sans-serif';
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, size / 2, size);
        ctx.clip();
        ctx.fillText(this.data.leftEmoji, size / 2, size / 2 + 8);
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.rect(size / 2, 0, size / 2, size);
        ctx.clip();
        ctx.fillText(this.data.rightEmoji, size / 2, size / 2 + 8);
        ctx.restore();
        wx.canvasToTempFilePath({ canvas, fileType: 'png', destWidth: size, destHeight: size, success: result => resolve(result.tempFilePath), fail: reject });
      });
    });
  },

  onShareAppMessage() {
    const { leftEmoji, rightEmoji } = this.data;
    return {
      title: `${leftEmoji} + ${rightEmoji}，看看我合成的新表情`,
      path: `/pages/emojiMixer/emojiMixer?left=${encodeURIComponent(leftEmoji)}&right=${encodeURIComponent(rightEmoji)}`
    };
  }
});
