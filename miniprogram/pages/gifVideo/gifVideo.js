Page({
  data: {
    video: null,
    crop: null,
    fps: 10,
    resolutionIndex: 2,
    resolutions: ['原图', '480px', '320px', '240px'],
    loop: 0,
    auditing: false,
    converting: false,
    resultVisible: false,
    generatedGif: ''
  },
  goBack() { wx.navigateBack(); },
  formatDuration(seconds) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  },
  extension(path) {
    return ((String(path).match(/\.([a-zA-Z0-9]+)(?:\?|$)/) || [])[1] || 'mp4').toLowerCase();
  },
  async chooseVideo() {
    if (this.data.auditing) return;
    try {
      const picked = await wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['album', 'camera'], maxDuration: 60 });
      if (!picked.tempFiles || !picked.tempFiles.length) return;
      const file = picked.tempFiles[0];
      await this.prepareVideo({
        path: file.tempFilePath,
        thumb: file.thumbTempFilePath || '',
        duration: Number(file.duration) || 0,
        width: Number(file.width) || 0,
        height: Number(file.height) || 0,
        size: Number(file.size) || 0
      });
    } catch (error) {
      if (!/cancel/i.test(String(error.errMsg || error.message))) {
        wx.showToast({ title: '选择视频失败', icon: 'none' });
      }
    }
  },
  async prepareVideo(video) {
    let result = video;
    if (video.duration > 10) {
      result = await this.openEditor(video, true);
      if (!result) return;
    }
    if (result.duration > 10.05) {
      wx.showModal({ title: '视频过长', content: '请将视频截取到 10 秒以内。', showCancel: false });
      return;
    }
    await this.uploadAndAudit(result);
  },
  openEditor(video, required) {
    return new Promise(resolve => {
      if (!wx.openVideoEditor) {
        if (required) wx.showModal({ title: '无法截取视频', content: '当前微信版本不支持视频编辑，请升级微信后重试。', showCancel: false });
        resolve(required ? null : video);
        return;
      }
      wx.openVideoEditor({
        filePath: video.path,
        success: edited => resolve({
          ...video,
          path: edited.tempFilePath || edited.filePath || video.path,
          thumb: edited.thumbTempFilePath || video.thumb,
          duration: Number(edited.duration) || Math.min(video.duration, 10),
          width: Number(edited.width) || video.width,
          height: Number(edited.height) || video.height,
          size: Number(edited.size) || video.size
        }),
        fail: error => {
          if (!/cancel/i.test(String(error.errMsg || error.message))) wx.showToast({ title: '视频截取失败', icon: 'none' });
          resolve(null);
        }
      });
    });
  },
  async trimVideo() {
    const edited = await this.openEditor(this.data.video, false);
    if (!edited) return;
    if (edited.duration > 10.05) return wx.showToast({ title: '最长只能保留10秒', icon: 'none' });
    await this.uploadAndAudit(edited);
  },
  async uploadAndAudit(video) {
    this.setData({ auditing: true });
    wx.showLoading({ title: '视频审核中', mask: true });
    let fileID = '';
    try {
      const ext = this.extension(video.path);
      if (!['mp4', 'mov'].includes(ext)) throw new Error('仅支持 MP4/MOV 格式');
      const uploaded = await wx.cloud.uploadFile({ cloudPath: `video-audit/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`, filePath: video.path });
      fileID = uploaded.fileID;
      const response = await wx.cloud.callFunction({ name: 'gifImages', data: { action: 'auditVideo', fileID } });
      const result = response.result;
      if (!result || !result.success) {
        const error = new Error((result && result.message) || '审核服务暂时不可用');
        error.code = result && result.errCode;
        throw error;
      }
      const duration = Math.min(10, Number(video.duration) || 0);
      this.setData({ video: { ...video, duration, durationText: this.formatDuration(duration), auditFileID: fileID }, crop: null });
      fileID = '';
    } catch (error) {
      const raw = String(error.message || error.errMsg || '请稍后重试');
      const invalidOpenid = String(error.code) === '40003' || /invalid openid/i.test(raw);
      wx.showModal({
        title: invalidOpenid ? '审核服务配置异常' : '视频审核暂时不可用',
        content: invalidOpenid ? '云函数未正确取得当前微信用户身份，请重新部署 gifImages 云函数后再试。视频本身没有被判定为违规。' : raw,
        showCancel: false
      });
    } finally {
      if (fileID) wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
      wx.hideLoading();
      this.setData({ auditing: false });
    }
  },
  changeVideo() {
    const old = this.data.video;
    this.setData({ video: null, crop: null });
    if (old && old.auditFileID) wx.cloud.deleteFile({ fileList: [old.auditFileID] }).catch(() => {});
  },
  openCrop() {
    const video = this.data.video;
    if (!video) return;
    wx.navigateTo({
      url: `/pages/gifCrop/gifCrop?path=${encodeURIComponent(video.path)}&width=${video.width}&height=${video.height}`,
      events: { cropConfirmed: crop => this.setData({ crop }) }
    });
  },
  clearCrop() { this.setData({ crop: null }); },
  fpsMinus() { if (this.data.fps > 1) this.setData({ fps: this.data.fps - 1 }); },
  fpsPlus() { if (this.data.fps < 30) this.setData({ fps: this.data.fps + 1 }); },
  changeResolution(e) { this.setData({ resolutionIndex: Number(e.detail.value) }); },
  loopMinus() { this.setData({ loop: this.data.loop === 0 ? 1 : Math.max(1, this.data.loop - 1) }); },
  loopPlus() { if (this.data.loop) this.setData({ loop: Math.min(99, this.data.loop + 1) }); },
  async startConvert() {
    if (!this.data.video || this.data.converting) return;
    this.setData({ converting: true });
    wx.showLoading({ title: '正在转换GIF', mask: true });
    try {
      const resolutionMap = [0, 480, 320, 240];
      const response = await wx.cloud.callFunction({
        name: 'gifImages',
        data: {
          action: 'generateVideo',
          fileID: this.data.video.auditFileID,
          sourceWidth: this.data.video.width,
          sourceHeight: this.data.video.height,
          crop: this.data.crop,
          fps: this.data.fps,
          resolution: resolutionMap[this.data.resolutionIndex],
          loop: this.data.loop
        },
        config: { timeout: 60000 }
      });
      const result = response.result;
      if (!result || !result.success) throw new Error((result && result.message) || '云端转换失败');
      const downloaded = await wx.cloud.downloadFile({ fileID: result.fileID });
      this.setData({ generatedGif: downloaded.tempFilePath, resultVisible: true });
    } catch (error) {
      const raw = String(error.message || error.errMsg || '请稍后重试');
      const missingFfmpeg = /FFmpeg|ENOENT|ffmpeg-static/i.test(raw);
      wx.showModal({
        title: missingFfmpeg ? '转换服务未完整部署' : '转换失败',
        content: missingFfmpeg ? '请重新上传并部署 gifImages 云函数，选择“云端安装依赖”后再试。' : raw.slice(0, 400),
        showCancel: false
      });
    } finally {
      wx.hideLoading(); this.setData({ converting: false });
    }
  },
  closeResult() { this.setData({ resultVisible: false }); },
  saveGif() {
    if (!this.data.generatedGif) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.generatedGif,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: error => {
        if (/auth deny/i.test(String(error.errMsg))) wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存图片到相册', success: r => r.confirm && wx.openSetting() });
        else wx.showToast({ title: '保存失败', icon: 'none' });
      }
    });
  },
  onUnload() {
    const video = this.data.video;
    if (video && video.auditFileID) wx.cloud.deleteFile({ fileList: [video.auditFileID] }).catch(() => {});
  }
});
