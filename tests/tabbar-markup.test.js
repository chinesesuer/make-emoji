const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'miniprogram', 'custom-tab-bar');
const iconNames = ['create', 'gif', 'warehouse', 'tools', 'profile'];

test('主入口复用共享底部导航 SVG 图标', () => {
  const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  iconNames.forEach(name => {
    assert.match(source, new RegExp(`/images/tabbar/${name}(?:-active)?\\.svg`));
  });
});
