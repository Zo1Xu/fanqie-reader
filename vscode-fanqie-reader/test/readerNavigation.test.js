'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('reader buttons and commands navigate across volumes using the catalog and retain progress on failed reading', async t => {
  const bookId = '9999999999999999999';
  const ids = ['1111111111111111111', '2222222222222222222', '3333333333333333333'];
  const commands = new Map();
  const contexts = new Map();
  const providers = new Map();
  const state = new Map();
  let receive;
  let view;
  const api = {
    EventEmitter: class { fire() {} }, ThemeIcon: class {}, TreeItem: class {},
    TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
    workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    commands: {
      registerCommand(name, callback) { commands.set(name, callback); return {}; },
      async executeCommand(name, ...args) {
        if (name === 'setContext') contexts.set(args[0], args[1]);
        if (name === 'workbench.view.extension.fanqieReaderPanel' && !view) {
          view = { visible: true, show() {}, onDidChangeVisibility() {}, onDidDispose() {},
            webview: { html: '', onDidReceiveMessage(callback) { receive = callback; } } };
          providers.get('fanqieReader.readerView').resolveWebviewView(view);
        }
      },
    },
    window: { createTreeView: () => ({}), registerWebviewViewProvider(name, provider) { providers.set(name, provider); return {}; },
      showErrorMessage(message) { assert.fail(message); } },
  };
  const originalLoad = Module._load;
  t.mock.method(Module, '_load', function (request, parent, main) {
    if (request === 'vscode') return api;
    assert.doesNotMatch(request, /mobileClient|mobileRuntime/);
    return originalLoad.call(this, request, parent, main);
  });
  let catalogLoads = 0;
  t.mock.method(global, 'fetch', async url => {
    const id = url.split('/').at(-1);
    let data;
    if (url.includes('/page/')) {
      catalogLoads++;
      data = { page: { bookId, bookName: '合成书', volumeNameList: ['上卷', '下卷'],
        chapterListWithVolume: [[{ itemId: ids[0], title: '第一章' }], [{ itemId: ids[1], title: '第二章' }, { itemId: ids[2], title: '第三章' }]] } };
    } else data = { reader: { chapterData: { itemId: id, bookId, title: `章节 ${id}`,
      isChapterLock: id === ids[2], content: '<p>合成完整正文</p>' } } };
    return new Response('<script>window.__INITIAL_STATE__=' + JSON.stringify(data) + ';</script>');
  });
  const { activate, deactivate } = require('../src/extension');
  t.after(() => deactivate());
  await activate({ subscriptions: [], secrets: { get: async () => undefined },
    globalState: { get: (key, fallback) => state.get(key) || fallback, update: async (key, value) => state.set(key, value) } });
  await commands.get('fanqieReader.openChapter')(ids[0]);
  const reader = providers.get('fanqieReader.readerView');
  assert.equal(reader.currentChapter.previousItemId, '');
  assert.equal(reader.currentChapter.nextItemId, ids[1]);
  assert.equal(contexts.get('fanqieReader.hasPreviousChapter'), false);
  assert.equal(contexts.get('fanqieReader.hasNextChapter'), true);
  assert.match(view.webview.html, /\.footer-nav\{[^}]*opacity:1/);
  await receive({ type: 'next' });
  assert.equal(reader.currentChapter.id, ids[1]);
  assert.equal(reader.currentChapter.previousItemId, ids[0]);
  await commands.get('fanqieReader.previousChapter')();
  assert.equal(reader.currentChapter.id, ids[0]);
  await commands.get('fanqieReader.nextChapter')();
  assert.equal(reader.currentChapter.id, ids[1]);
  await receive({ type: 'next' });
  assert.equal(reader.currentChapter.locked, true);
  assert.equal(reader.currentChapter.nextItemId, '');
  assert.equal(contexts.get('fanqieReader.hasPreviousChapter'), true);
  assert.equal(contexts.get('fanqieReader.hasNextChapter'), false);
  assert.equal(state.get('fanqieReader.history')[bookId].itemId, ids[1]);
  await receive({ type: 'previous' });
  assert.equal(reader.currentChapter.id, ids[1]);
  assert.equal(reader.currentChapter.locked, false);
  assert.equal(catalogLoads, 1);
});
