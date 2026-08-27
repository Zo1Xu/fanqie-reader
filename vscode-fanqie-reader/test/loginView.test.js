'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const executedCommands = [];
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      commands: {
        executeCommand: async (command) => executedCommands.push(command),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { LoginViewProvider, getLoginHtml } = require('../src/loginView');
Module._load = originalLoad;

test('login sidebar uses a strict CSP and accessible live regions', () => {
  const html = getLoginHtml();
  assert.match(html, /default-src 'none'/);
  assert.match(html, /img-src data:/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /button:focus-visible/);
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /for="phone"/);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.match(html, /aria-invalid/);
  assert.match(html, /不会自动破解滑块/);
  assert.match(html, /使用番茄小说账号，由官网统一认证/);
  assert.match(html, /Safari 还会显示官方二维码窗口/);
  assert.match(html, /class="qr-frame"/);
  assert.match(html, /\.qr\{display:block;width:auto;height:auto;max-width:100%/);
  assert.doesNotMatch(html, /width:min\(190px,85%\)/);
});

test('login action opens the contributed sidebar container', async () => {
  const provider = new LoginViewProvider({}, {});
  await provider.focus();
  assert.deepEqual(executedCommands, [
    'workbench.view.extension.fanqieReaderSidebar',
  ]);
});

test('logged-out shelf does not duplicate the visible account login view', () => {
  const manifest = require('../package.json');
  const loginView = manifest.contributes.views.fanqieReaderSidebar.find(
    (view) => view.id === 'fanqieReader.loginView',
  );
  const extensionSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'extension.js'),
    'utf8',
  );
  assert.equal(loginView.when, '!fanqieReader.loggedIn');
  assert.doesNotMatch(
    extensionSource,
    /登录番茄小说（验证码 \/ App 扫码）/,
  );
});
