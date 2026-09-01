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
const {
  LoginViewProvider,
  getLoginHtml,
  getQrPreviewHtml,
  isRasterDataUri,
} = require('../src/loginView');
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
  assert.match(html, /padding:16px/);
  assert.match(html, /扫描不成功？点击这里试试/);
  assert.match(html, /type:'openQrPreview'/);
  assert.doesNotMatch(html, /width:min\(190px,85%\)/);
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'loginView.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /#showQrPreview\(false\)/);
});

test('large QR preview preserves a white quiet zone and integer scaling', () => {
  const source = 'data:image/png;base64,iVBORw0KGgo=';
  const html = getQrPreviewHtml(source);
  assert.equal(isRasterDataUri(source), true);
  assert.equal(isRasterDataUri('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /background:#fff/);
  assert.match(html, /padding:24px/);
  assert.match(html, /Math\.floor\(available\/qr\.naturalWidth\)/);
  assert.match(html, /image-rendering:pixelated/);
  assert.match(html, /保持手机镜头与屏幕平行/);
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

test('reader and shelf actions use distinct product icons', () => {
  const manifest = require('../package.json');
  const icons = new Map(
    manifest.contributes.commands.map((command) => [command.command, command.icon]),
  );
  assert.equal(icons.get('fanqieReader.open'), '$(book)');
  assert.equal(icons.get('fanqieReader.showReader'), '$(preview)');
  assert.equal(icons.get('fanqieReader.refresh'), '$(sync)');

  const shelfTitleActions = manifest.contributes.menus['view/title']
    .filter((item) => item.when.includes('view == fanqieReader.shelf'))
    .map((item) => item.command);
  assert.deepEqual(shelfTitleActions, [
    'fanqieReader.open',
    'fanqieReader.refresh',
  ]);
  assert.equal(new Set(shelfTitleActions).size, shelfTitleActions.length);
  assert.ok(
    manifest.contributes.menus['view/title'].every(
      (item) => item.when.includes('fanqieReader.currentExtensionActive'),
    ),
  );
});
