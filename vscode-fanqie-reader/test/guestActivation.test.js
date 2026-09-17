'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('guest activation and reading need no browser and survive unavailable account storage', async (t) => {
  const commands = new Map();
  const contexts = new Map();
  const providers = new Map();
  const errors = [];
  const state = new Map();
  let readerView;
  const api = {
    EventEmitter: class { fire() {} },
    ThemeIcon: class {}, TreeItem: class {},
    TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
    workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    commands: {
      registerCommand: (name, callback) => { commands.set(name, callback); return {}; },
      executeCommand: async (name, ...args) => {
        if (name === 'setContext') contexts.set(args[0], args[1]);
        if (name === 'workbench.view.extension.fanqieReaderPanel' && !readerView) {
          readerView = { visible: true, show() {}, onDidChangeVisibility() {}, onDidDispose() {},
            webview: { html: '', onDidReceiveMessage() {} } };
          providers.get('fanqieReader.readerView').resolveWebviewView(readerView);
        }
      },
    },
    window: {
      createTreeView: () => ({}),
      registerWebviewViewProvider: (name, provider) => { providers.set(name, provider); return {}; },
      showInformationMessage() {},
      showErrorMessage: (message) => errors.push(message),
    },
  };
  const originalLoad = Module._load;
  t.mock.method(Module, '_load', function (request, parent, isMain) {
    if (request === 'vscode') return api;
    if (/^(playwright-core|selenium-webdriver)(\/|$)/.test(request)) {
      throw new Error('Guest path loaded browser automation');
    }
    return originalLoad.call(this, request, parent, isMain);
  });
  let requestCount = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.match(url, /\/reader\/7175147347041911356$/);
    assert.equal(options.headers.Cookie, undefined);
    requestCount += 1;
    return new Response('<script>window.__INITIAL_STATE__=' + JSON.stringify({
      reader: { chapterData: {
        itemId: '7175147347041911356', bookId: '7143038691944959011',
        title: '合成章节', content: '<p>访客测试正文</p>', isChapterLock: false,
      } },
    }) + ';</script>');
  });
  const { activate, deactivate } = require('../src/extension');
  t.after(() => deactivate());
  await activate({ subscriptions: [],
    secrets: { get: async () => { throw new Error('storage unavailable'); } },
    globalState: {
      get: (key, fallback) => state.get(key) || fallback,
      update: async (key, value) => state.set(key, value),
    },
  });
  assert.equal(contexts.get('fanqieReader.loginRequested'), false);
  assert.equal(requestCount, 0);
  await commands.get('fanqieReader.openChapter')('7175147347041911356');
  assert.match(readerView.webview.html, /访客测试正文/);
  assert.equal(requestCount, 1);
  assert.equal(contexts.get('fanqieReader.loginRequested'), false);
  assert.deepEqual(errors, []);

  // Explicitly opening login must not pretend an existing account logged out.
  contexts.set('fanqieReader.loggedIn', true);
  await commands.get('fanqieReader.login')();
  assert.equal(contexts.get('fanqieReader.loginRequested'), true);
  assert.equal(contexts.get('fanqieReader.loggedIn'), true);
  await providers.get('fanqieReader.loginView').callbacks.onDismiss();
  assert.equal(contexts.get('fanqieReader.loginRequested'), false);
  assert.equal(contexts.get('fanqieReader.loggedIn'), true);

  // Login success refreshes a visible restricted chapter, leaving readable pages alone.
  const reader = providers.get('fanqieReader.readerView');
  await reader.retryRestrictedChapter();
  assert.equal(requestCount, 1);
  reader.currentChapter.locked = true;
  await reader.retryRestrictedChapter();
  assert.equal(requestCount, 2);
  reader.currentChapter.locked = true;
  readerView.visible = false;
  await reader.retryRestrictedChapter();
  assert.equal(requestCount, 2);
});
