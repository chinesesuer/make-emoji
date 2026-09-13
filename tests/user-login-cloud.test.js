const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const { loginUser, sanitizeProfile } = require('../cloudfunctions/quickstartFunctions/user-login.js');

function createDatabase() {
  const records = [];
  const collection = {
    where(query) {
      return {
        limit(limit) {
          return {
            async get() {
              return { data: records.filter(record => record._openid === query._openid).slice(0, limit) };
            },
          };
        },
      };
    },
    async add({ data }) {
      records.push({ _id: `user-${records.length + 1}`, ...data });
    },
    doc(id) {
      return {
        async update({ data }) {
          const record = records.find(item => item._id === id);
          Object.assign(record, data);
        },
      };
    },
  };

  return { collection(name) { assert.equal(name, 'users'); return collection; }, records };
}

function loadLoginHandler(cloud) {
  const indexPath = require.resolve('../cloudfunctions/quickstartFunctions/index.js');
  const originalLoad = Module._load;
  delete require.cache[indexPath];
  Module._load = function loadWxServerSdk(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(indexPath).main;
  } finally {
    Module._load = originalLoad;
    delete require.cache[indexPath];
  }
}

test('首次登录创建一条用户记录', async () => {
  const db = createDatabase();
  const now = new Date('2026-09-13T00:00:00.000Z');

  const result = await loginUser({ db, openid: 'trusted-openid', profile: { nickName: ' 小明 ', avatarUrl: ' https://avatar.example/a.png ' }, now });

  assert.deepEqual(result, { success: true, user: { openid: 'trusted-openid', nickName: '小明', avatarUrl: 'https://avatar.example/a.png' } });
  assert.deepEqual(db.records, [{ _id: 'user-1', _openid: 'trusted-openid', nickName: '小明', avatarUrl: 'https://avatar.example/a.png', lastLoginAt: now, createdAt: now }]);
});

test('users 集合不存在时自动创建后完成登录', async () => {
  const db = createDatabase();
  let collectionReady = false;
  const originalCollection = db.collection;
  db.collection = function collection(name) {
    const users = originalCollection.call(this, name);
    const originalWhere = users.where;
    users.where = function where(query) {
      const operation = originalWhere.call(this, query);
      const originalLimit = operation.limit;
      operation.limit = function limit(value) {
        const request = originalLimit.call(this, value);
        const originalGet = request.get;
        request.get = async function get() {
          if (!collectionReady) {
            const error = new Error('collection users not exists');
            error.errCode = -502005;
            throw error;
          }
          return originalGet.call(this);
        };
        return request;
      };
      return operation;
    };
    return users;
  };
  db.createCollection = async name => {
    assert.equal(name, 'users');
    collectionReady = true;
  };

  const result = await loginUser({ db, openid: 'trusted-openid', profile: { nickName: '小明' } });

  assert.equal(result.success, true);
  assert.equal(db.records.length, 1);
  assert.equal(db.records[0]._openid, 'trusted-openid');
});

test('重复登录更新已有用户而不创建重复记录', async () => {
  const db = createDatabase();
  await loginUser({ db, openid: 'trusted-openid', profile: { nickName: '旧昵称' }, now: new Date('2026-09-12T00:00:00.000Z') });
  const now = new Date('2026-09-13T00:00:00.000Z');

  await loginUser({ db, openid: 'trusted-openid', profile: { nickName: '新昵称', avatarUrl: '新头像' }, now });

  assert.equal(db.records.length, 1);
  assert.deepEqual(db.records[0], { _id: 'user-1', _openid: 'trusted-openid', nickName: '新昵称', avatarUrl: '新头像', lastLoginAt: now, createdAt: new Date('2026-09-12T00:00:00.000Z') });
});

test('昵称和头像地址会去除空白并按 40 和 1000 个字符截断', () => {
  const profile = sanitizeProfile({ nickName: ` ${'名'.repeat(41)} `, avatarUrl: ` ${'a'.repeat(1001)} ` });

  assert.deepEqual(profile, { nickName: '名'.repeat(40), avatarUrl: 'a'.repeat(1000) });
});

test('非字符串资料字段使用默认昵称和空头像', () => {
  assert.deepEqual(sanitizeProfile({ nickName: 123, avatarUrl: {} }), { nickName: '微信用户', avatarUrl: '' });
});

test('缺少可信 openid 时拒绝登录', async () => {
  await assert.rejects(loginUser({ db: createDatabase(), profile: { nickName: '小明' } }), { message: '无法获取微信用户身份' });
});

test('伪造的 profile.openid 不会影响返回值或存储身份', async () => {
  const db = createDatabase();

  const result = await loginUser({ db, openid: 'trusted-openid', profile: { openid: 'forged-openid', nickName: '小明' }, now: new Date('2026-09-13T00:00:00.000Z') });

  assert.equal(result.user.openid, 'trusted-openid');
  assert.equal(db.records[0]._openid, 'trusted-openid');
  assert.equal(db.records[0].openid, undefined);
});

test('登录入口只信任 cloud.getWXContext 的 OPENID', async () => {
  const db = createDatabase();
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'current-env',
    init() {},
    database() { return db; },
    getWXContext() { return { OPENID: 'cloud-trusted-openid' }; },
  };
  const main = loadLoginHandler(cloud);

  const result = await main({
    type: 'login',
    openid: 'forged-event-openid',
    profile: { openid: 'forged-profile-openid', nickName: '小明' },
  });

  assert.equal(result.user.openid, 'cloud-trusted-openid');
  assert.equal(db.records[0]._openid, 'cloud-trusted-openid');
  assert.equal(db.records[0].openid, undefined);
});
