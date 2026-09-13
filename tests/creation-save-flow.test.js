const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadIndex(wx, fingerprint = '0123456789abcdef') {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/index/index.js'), 'utf8');
  vm.runInNewContext(source, {
    Page(value) { definition = value; }, wx, console: { error() {} }, setTimeout,
    require(request) {
      if (request === '../../utils/auth') return { ensureLogin: async () => ({ openid: 'user-1' }) };
      if (request === '../../utils/material-loader') return { splitIntoBatches: () => [], applyTemporaryUrls: value => value };
      if (request === '../../utils/creation-fingerprint') return { buildCreationFingerprint: () => fingerprint };
      throw new Error(`unexpected import ${request}`);
    }
  });
  return definition;
}

function context(definition) {
  return {
    ...definition,
    data: { ...definition.data, generatedImage: '/tmp/result.png', resultVisible: true },
    setData(update) { Object.assign(this.data, update); }
  };
}

test('生成图片归档时上传并保存作品记录', async () => {
  const calls = [];
  const wx = { cloud: {
    async uploadFile(options) { calls.push(['upload', options]); return { fileID: 'cloud://new.png' }; },
    async callFunction(options) { calls.push(['call', options]); return { result: { success: true } }; },
    async deleteFile(options) { calls.push(['delete', options]); }
  } };
  const page = context(loadIndex(wx));

  const saved = await page.archiveGeneratedCreation('/tmp/result.png', 'png', { openid: 'user-1' });

  assert.equal(saved, true);
  assert.match(calls[0][1].cloudPath, /^user-creations\/user-1\/0123456789abcdef-\d+\.png$/);
  assert.equal(calls[0][1].filePath, '/tmp/result.png');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1].data)), {
    type: 'saveCreation',
    creation: { fingerprint: '0123456789abcdef', fileID: 'cloud://new.png', fileType: 'png' }
  });
});

test('保存作品记录失败时清理新文件并保留生成结果', async () => {
  const calls = [];
  const wx = {
    showToast(options) { calls.push(['toast', options]); },
    cloud: {
      async uploadFile() { return { fileID: 'cloud://orphan.png' }; },
      async callFunction() { throw new Error('database failed'); },
      async deleteFile(options) { calls.push(['delete', options]); }
    }
  };
  const page = context(loadIndex(wx));

  const saved = await page.archiveGeneratedCreation('/tmp/result.png', 'png', { openid: 'user-1' });

  assert.equal(saved, false);
  assert.equal(page.data.generatedImage, '/tmp/result.png');
  assert.equal(page.data.resultVisible, true);
  assert.deepEqual(Array.from(calls.find(([name]) => name === 'delete')[1].fileList), ['cloud://orphan.png']);
  assert.equal(calls.find(([name]) => name === 'toast')[1].title, '作品保存失败，请稍后重试');
});
