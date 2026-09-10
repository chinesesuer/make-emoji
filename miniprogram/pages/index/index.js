Page({
  data: { currentStep: 0, steps: ['选身体','选表情','选挂件','贴文字','存表情'], categories: [[], [], []], categoryIndex: 0, selectedBody: -1, selectedExpression: -1, selectedAccessory: -1, bodies: [], expressions: [], accessories: [], body: '', expression: '', accessory: '', text: '', textInput: '', textStyle: 0, textColor: '#111111', strokeColor: '#ffffff', textPosition: 'bottom', hotTexts: [], textBold: false, textStroke: true, activeLayer: '', bodyPosition: { x: 50, y: 50 }, expressionPosition: { x: 42, y: 56 }, accessoryPosition: { x: 62, y: 38 }, textPositionData: { x: 50, y: 84 }, bodyTransform: { scale: 1, rotate: 0, flip: false }, expressionTransform: { scale: 1, rotate: 0, flip: false }, accessoryTransform: { scale: 1, rotate: 0, flip: false }, textTransform: { scale: 1, rotate: 0, flip: false } },
  onLoad() {
    this.materialsByScene = { body: [], face: [], accessory: [] };
    this.localFileCache = {};
    this.sceneLoadTasks = {};
    this.materialsReady = this.loadCloudMaterials();
  },
  async loadCloudMaterials() {
    const scenes = [{ scene: 'body', key: 'bodies' }, { scene: 'face', key: 'expressions' }, { scene: 'accessory', key: 'accessories' }];
    await Promise.all(scenes.map(async ({ scene, key }) => {
      try {
        const { result } = await wx.cloud.callFunction({ name: 'materialService', data: { scene } });
        if (result.success) {
          const categories = this.data.categories.slice();
          const sceneIndex = scenes.findIndex(item => item.scene === scene);
          categories[sceneIndex] = [...new Set(result.list.map(item => item.categoryName).filter(Boolean))];
          this.materialsByScene[scene] = result.list;
          this.setData({ categories });
        }
      } catch (_) { /* 云环境未配置或请求失败时保持空列表 */ }
    }));
    await this.loadSceneImages('body');
    // 空闲时预取另外两类素材，后续切换标签直接使用本地路径。
    this.loadSceneImages('face');
    this.loadSceneImages('accessory');
  },
  async loadSceneImages(scene) {
    const sourceMap = { body: 'bodies', face: 'expressions', accessory: 'accessories' };
    if (this.sceneLoadTasks[scene]) return this.sceneLoadTasks[scene];
    this.sceneLoadTasks[scene] = Promise.all((this.materialsByScene[scene] || []).map(async item => {
      if (!item.fileUrl || this.localFileCache[item.fileUrl]) return { ...item, fileUrl: this.localFileCache[item.fileUrl] || item.fileUrl };
      try {
        const result = await wx.cloud.downloadFile({ fileID: item.fileUrl });
        this.localFileCache[item.fileUrl] = result.tempFilePath;
        return { ...item, fileUrl: result.tempFilePath };
      } catch (_) { return item; }
    })).then(list => this.setData({ [sourceMap[scene]]: list }));
    return this.sceneLoadTasks[scene];
  },
  chooseStep(e) {
    const index = e.currentTarget.dataset.index;
    const sceneMap = ['body', 'expression', 'accessory'];
    this.setData({ currentStep: index, categoryIndex: 0, activeLayer: sceneMap[index] || this.data.activeLayer });
    const cloudSceneMap = ['body', 'face', 'accessory'];
    if (cloudSceneMap[index]) this.materialsReady.then(() => this.loadSceneImages(cloudSceneMap[index]));
  },
  chooseCategory(e) { this.setData({categoryIndex:e.currentTarget.dataset.index}); },
  chooseItem(e) {
    const { type, index } = e.currentTarget.dataset;
    const sourceMap = { body: 'bodies', expression: 'expressions', accessory: 'accessories' };
    const list = this.data[sourceMap[type]];
    const item = list[index];
    const updates = {
      [`selected${type[0].toUpperCase() + type.slice(1)}`]: index,
      [type]: typeof item === 'string' ? item : item.name,
      [`${type}FileUrl`]: typeof item === 'string' ? '' : item.fileUrl,
      activeLayer: type
    };
    if (type === 'body') Object.assign(updates, { bodyPosition: { x: 50, y: 50 }, bodyTransform: { scale: 1, rotate: 0, flip: false } });
    if (type === 'expression') Object.assign(updates, { expressionPosition: { x: 50, y: 50 }, expressionTransform: { scale: 5, rotate: 0, flip: false } });
    if (type === 'accessory') Object.assign(updates, { accessoryPosition: { x: 50, y: 50 }, accessoryTransform: { scale: 7, rotate: 0, flip: false } });
    this.setData(updates);
  },
  removeLayer(e) {
    const type = e.currentTarget.dataset.layer;
    const key = `selected${type[0].toUpperCase() + type.slice(1)}`;
    this.setData({ [key]: -1, [type]: '', [`${type}FileUrl`]: '', activeLayer: '' });
  },
  startGesture(e) {
    const layer = this.data.activeLayer || e.target.dataset.layer;
    if (!layer) return;
    this.gestureVersion = (this.gestureVersion || 0) + 1;
    const version = this.gestureVersion;
    if (e.touches.length >= 2) {
      const [first, second] = e.touches;
      this.gesture = { mode: 'pinch', layer, distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY), angle: Math.atan2(second.clientY - first.clientY, second.clientX - first.clientX) * 180 / Math.PI, transform: { ...this.data[`${layer}Transform`] } };
      this.setData({ activeLayer: layer });
      return;
    }
    const point = e.touches[0];
    this.createSelectorQuery().select('.canvas').boundingClientRect(rect => {
      if (!rect || version !== this.gestureVersion) return;
      const positionKey = layer === 'text' ? 'textPositionData' : `${layer}Position`;
      this.gesture = { mode: 'drag', layer, positionKey, startX: point.clientX, startY: point.clientY, rect, position: { ...this.data[positionKey] }, moved: false };
      this.setData({ activeLayer: layer });
    }).exec();
  },
  moveGesture(e) {
    if (!this.gesture) return;
    if (e.touches.length >= 2 && this.gesture.mode !== 'pinch') {
      const [first, second] = e.touches;
      const layer = this.gesture.layer;
      this.gesture = {
        mode: 'pinch',
        layer,
        distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
        angle: Math.atan2(second.clientY - first.clientY, second.clientX - first.clientX) * 180 / Math.PI,
        transform: { ...this.data[`${layer}Transform`] }
      };
      return;
    }
    if (this.gesture.mode === 'pinch' && e.touches.length >= 2) {
      const [first, second] = e.touches;
      const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
      const angle = Math.atan2(second.clientY - first.clientY, second.clientX - first.clientX) * 180 / Math.PI;
      const { layer, transform } = this.gesture;
      this.setData({ [`${layer}Transform`]: { ...transform, scale: Math.max(0.2, Math.min(9, transform.scale * distance / this.gesture.distance)), rotate: transform.rotate + angle - this.gesture.angle } });
      return;
    }
    if (this.gesture.mode !== 'drag') return;
    const point = e.touches[0];
    const { layer, positionKey, startX, startY, rect, position } = this.gesture;
    const x = Math.max(8, Math.min(92, position.x + (point.clientX - startX) / rect.width * 100));
    const y = Math.max(10, Math.min(90, position.y + (point.clientY - startY) / rect.height * 100));
    if (Math.abs(point.clientX - startX) > 5 || Math.abs(point.clientY - startY) > 5) this.gesture.moved = true;
    this.setData({ [positionKey]: { x, y } });
  },
  endGesture() {
    if (this.gesture && this.gesture.mode === 'drag' && !this.gesture.moved) {
      const key = `${this.gesture.layer}Transform`;
      this.setData({ [`${key}.flip`]: !this.data[key].flip });
    }
    this.gesture = null;
    this.gestureVersion = (this.gestureVersion || 0) + 1;
  },
  updateText(e) {
    const value = e.detail.value;
    const firstText = !this.data.text && !!value;
    const updates = { textInput: value, text: value, activeLayer: value ? 'text' : '' };
    if (firstText) {
      updates.bodyTransform = { ...this.data.bodyTransform, scale: this.data.bodyTransform.scale * 0.8 };
      updates.expressionTransform = { ...this.data.expressionTransform, scale: this.data.expressionTransform.scale * 0.8 };
      updates.accessoryTransform = { ...this.data.accessoryTransform, scale: this.data.accessoryTransform.scale * 0.8 };
    }
    this.setData(updates);
  },
  addText() {
    const firstText = !this.data.text;
    const updates = { text: this.data.textInput, activeLayer: 'text', textPositionData: { x: 50, y: 84 }, textTransform: { scale: 1, rotate: 0, flip: false } };
    if (firstText) {
      updates.bodyTransform = { ...this.data.bodyTransform, scale: this.data.bodyTransform.scale * 0.8 };
      updates.expressionTransform = { ...this.data.expressionTransform, scale: this.data.expressionTransform.scale * 0.8 };
      updates.accessoryTransform = { ...this.data.accessoryTransform, scale: this.data.accessoryTransform.scale * 0.8 };
    }
    this.setData(updates);
  },
  clearText() { this.setData({ text: '', textInput: '', activeLayer: '' }); },
  clearCanvas() {
    wx.showModal({
      title: '提示',
      content: '确定要清空画布所有内容吗？',
      cancelText: '取消',
      confirmText: '确定',
      confirmColor: '#55c888',
      success: ({ confirm }) => {
        if (confirm) this.doClearCanvas();
      }
    });
  },
  doClearCanvas() {
    this.setData({
      body: '', expression: '', accessory: '', text: '', textInput: '',
      bodyFileUrl: '', expressionFileUrl: '', accessoryFileUrl: '',
      selectedBody: -1, selectedExpression: -1, selectedAccessory: -1, activeLayer: '',
      bodyPosition: { x: 50, y: 50 }, expressionPosition: { x: 42, y: 56 }, accessoryPosition: { x: 62, y: 38 }, textPositionData: { x: 50, y: 84 },
      bodyTransform: { scale: 1, rotate: 0, flip: false }, expressionTransform: { scale: 1, rotate: 0, flip: false }, accessoryTransform: { scale: 1, rotate: 0, flip: false }, textTransform: { scale: 1, rotate: 0, flip: false }
    });
    wx.showToast({ title: '画布已清空', icon: 'none' });
  },
  toggleBold() { this.setData({ textBold: !this.data.textBold }); },
  toggleStroke() { this.setData({ textStroke: !this.data.textStroke }); },
  setTextColor(e) { this.setData({ textColor: e.currentTarget.dataset.color }); },
  setStrokeColor(e) { this.setData({ strokeColor: e.currentTarget.dataset.color }); },
  chooseTextStyle(e) {this.setData({textStyle:e.currentTarget.dataset.index});}, chooseColor(e) {this.setData({textColor:e.currentTarget.dataset.color});}, choosePosition(e) {this.setData({textPosition:e.currentTarget.dataset.position});},
  goProfile() {wx.navigateTo({url:'/pages/profile/profile'});}, saveImage() {wx.showToast({title:'表情已保存',icon:'success'});}, saveToWarehouse() {wx.showToast({title:'已存入表情仓库',icon:'success'});}, share() {wx.showToast({title:'点击右上角分享给好友',icon:'none'});}
});
