const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const { saveCreation, listCreations } = require('../cloudfunctions/quickstartFunctions/creation-service.js');

function createDatabase() {
  const records = [];
  const collection = {
    doc(id) {
      return {
        async get() {
          const record = records.find(item => item._id === id);
          if (!record) {
            const error = new Error('document not exists');
            error.errCode = -1;
            throw error;
          }
          return { data: record };
        },
        async set({ data }) {
          const index = records.findIndex(item => item._id === id);
          const record = { _id: id, ...data };
          if (index >= 0) records[index] = record;
          else records.push(record);
        },
        async update({ data }) {
          Object.assign(records.find(item => item._id === id), data);
        }
      };
    },
    where(query) {
      let output = records.filter(item => item._openid === query._openid);
      return {
        orderBy(field, direction) {
          output = output.sort((a, b) => direction === 'desc' ? b[field] - a[field] : a[field] - b[field]);
          return this;
        },
        limit(value) { output = output.slice(0, value); return this; },
        async get() { return { data: output }; }
      };
    }
  };
  return { collection(name) { assert.equal(name, 'creations'); return collection; }, records };
}

function loadMain(cloud) {
  const indexPath = require.resolve('../cloudfunctions/quickstartFunctions/index.js');
  const originalLoad = Module._load;
  delete require.cache[indexPath];
  Module._load = function(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud;
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(indexPath).main; }
  finally { Module._load = originalLoad; delete require.cache[indexPath]; }
}

test('相同用户和内容更新原作品并清理旧文件', async () => {
  const db = createDatabase();
  const deleted = [];
  const firstDate = new Date('2026-09-12T00:00:00Z');
  const latestDate = new Date('2026-09-13T00:00:00Z');
  const base = { db, openid: 'u1', fingerprint: '0123456789abcdef', fileType: 'png', deleteFiles: async files => deleted.push(...files) };

  await saveCreation({ ...base, fileID: 'cloud://old.png', now: firstDate });
  await saveCreation({ ...base, fileID: 'cloud://new.png', now: latestDate });

  assert.equal(db.records.length, 1);
  assert.equal(db.records[0].fileID, 'cloud://new.png');
  assert.equal(db.records[0].createdAt, firstDate);
  assert.equal(db.records[0].updatedAt, latestDate);
  assert.deepEqual(deleted, ['cloud://old.png']);
});

test('不同用户相同内容保存为相互隔离的作品', async () => {
  const db = createDatabase();
  const input = { db, fingerprint: '0123456789abcdef', fileType: 'png', deleteFiles: async () => {} };

  await saveCreation({ ...input, openid: 'u1', fileID: 'cloud://u1.png' });
  await saveCreation({ ...input, openid: 'u2', fileID: 'cloud://u2.png' });

  assert.equal(db.records.length, 2);
  assert.deepEqual((await listCreations({ db, openid: 'u1' })).creations.map(item => item.fileID), ['cloud://u1.png']);
});

test('作品列表按更新时间倒序并最多返回五十条', async () => {
  const db = createDatabase();
  for (let index = 0; index < 55; index += 1) {
    await saveCreation({
      db, openid: 'u1', fingerprint: index.toString(16).padStart(16, '0'),
      fileID: `cloud://${index}.png`, fileType: 'png', now: new Date(2026, 0, index + 1), deleteFiles: async () => {}
    });
  }

  const result = await listCreations({ db, openid: 'u1', limit: 99 });

  assert.equal(result.creations.length, 50);
  assert.equal(result.creations[0].fileID, 'cloud://54.png');
  assert.equal(result.creations[49].fileID, 'cloud://5.png');
  assert.equal(result.creations[0]._openid, undefined);
  assert.equal(result.creations[0].fingerprint, undefined);
});

test('非法身份和作品字段会被拒绝', async () => {
  const db = createDatabase();
  const valid = { db, openid: 'u1', fingerprint: '0123456789abcdef', fileID: 'cloud://a.png', fileType: 'png' };
  await assert.rejects(saveCreation({ ...valid, openid: '' }));
  await assert.rejects(saveCreation({ ...valid, fingerprint: 'bad' }));
  await assert.rejects(saveCreation({ ...valid, fileID: '' }));
  await assert.rejects(saveCreation({ ...valid, fileType: 'gif' }));
  await assert.rejects(listCreations({ db, openid: '' }));
});

test('云函数保存和列表只使用可信微信 OPENID', async () => {
  const db = createDatabase();
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'env', init() {}, database: () => db,
    getWXContext: () => ({ OPENID: 'trusted-user' }),
    deleteFile: async () => {}
  };
  const main = loadMain(cloud);

  await main({
    type: 'saveCreation',
    openid: 'forged-event-user',
    creation: { openid: 'forged-creation-user', fingerprint: '0123456789abcdef', fileID: 'cloud://safe.png', fileType: 'png' }
  });
  const listed = await main({ type: 'listCreations', openid: 'forged-event-user' });

  assert.equal(db.records[0]._openid, 'trusted-user');
  assert.equal(listed.creations.length, 1);
  assert.equal(listed.creations[0].fileID, 'cloud://safe.png');
});
