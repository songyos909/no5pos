import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('HTML ids are unique and asset versions match', async () => {
  const html = await read('public/index.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
  const versions = [...html.matchAll(/(?:app\.js|firebase-client\.js|styles\.css)\?v=([^"'&]+)/g)].map(match => match[1]);
  assert.equal(versions.length, 3);
  assert.equal(new Set(versions).size, 1, 'asset cache versions differ');
});

test('all static app element references exist', async () => {
  const [html, app] = await Promise.all([read('public/index.html'), read('public/app.js')]);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const refs = [...app.matchAll(/\$\('#([^']+)'\)/g)].map(match => match[1]);
  const missing = [...new Set(refs.filter(id => !ids.has(id) && id !== 'active-modules'))];
  assert.deepEqual(missing, []);
});

test('checkout security and reusable options exist in both backends', async () => {
  const [server, firebase] = await Promise.all([read('server.js'), read('public/firebase-client.js')]);
  for (const source of [server, firebase]) {
    assert.match(source, /manualDiscount/);
    assert.match(source, /option-groups/);
    assert.match(source, /channelPrices|channel_prices/);
    assert.match(source, /redeemFreeCup/);
  }
  assert.match(firebase, /inventoryReads/);
  assert.match(server, /\+7 hours/);
});

test('Firebase migration includes options, online prices and boolean conversion', async () => {
  const html = await read('public/firebase-import.html');
  assert.match(html, /optionGroups/);
  assert.match(html, /channelPrices/);
  assert.match(html, /deduct_stock:x\.deduct_stock!==0/);
  assert.match(html, /active:x\.active!==0/);
});
