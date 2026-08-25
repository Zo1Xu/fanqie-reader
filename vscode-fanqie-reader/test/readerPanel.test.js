'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// readerPanel imports vscode at runtime. Load only the pure helper with a minimal module stub.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key, fallback) => fallback,
        }),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  READER_CONTAINER_COMMAND,
  READER_VIEW_ID,
  createTerminalPrompt,
  getChapterHtml,
  getEmptyHtml,
  sanitizeChapterContent,
} = require('../src/readerPanel');
Module._load = originalLoad;

test('sanitizeChapterContent preserves paragraphs and removes executable markup', () => {
  const result = sanitizeChapterContent(
    '<p>第一段 &amp; 文本</p><script>alert(1)</script><p>第二段<br>换行</p>',
  );
  assert.equal(result.includes('<script>'), false);
  assert.equal(result.includes('<p>第一段 &amp; 文本</p>'), true);
  assert.equal(result.includes('<p>alert(1)第二段<br>换行</p>'), true);
});

test('reader is contributed as a bottom panel Webview view', () => {
  const manifest = require('../package.json');
  assert.equal(READER_VIEW_ID, 'fanqieReader.readerView');
  assert.equal(
    READER_CONTAINER_COMMAND,
    'workbench.view.extension.fanqieReaderPanel',
  );
  assert.deepEqual(manifest.contributes.viewsContainers.panel, [
    {
      id: 'fanqieReaderPanel',
      title: 'fanqieReader',
      icon: 'resources/tomato.svg',
    },
  ]);
  assert.equal(
    manifest.contributes.views.fanqieReaderPanel[0].type,
    'webview',
  );
});

test('chapter HTML uses terminal colors and accessible navigation', () => {
  const prompt = 'PS D:\\work\\projects\\supplychain-leasing-system>';
  const html = getChapterHtml(
    {},
    {
      id: '12345678901',
      bookId: '22345678901',
      bookName: '测试小说',
      author: '测试作者',
      title: '第 37 章 夜色',
      wordCount: 1234,
      content: '<p>夜色逐渐笼罩下来。</p>',
      previousItemId: '32345678901',
      nextItemId: '42345678901',
      order: 37,
      locked: false,
      fontDataUri: '',
    },
    { terminalPrompt: prompt },
  );
  assert.match(html, /--vscode-terminal-background/);
  assert.equal(
    html.match(/PS D:\\work\\projects\\supplychain-leasing-system&gt;/g)?.length,
    2,
  );
  assert.match(html, /\[INFO\]<\/span> Loading project context\.\.\./);
  assert.match(html, /Dependency resolution completed\./);
  assert.match(html, /Chapter resolved: 测试小说 \/ 第 37 章 夜色/);
  assert.match(html, /<header class="terminal-header" aria-label="当前章节终端状态">/);
  assert.match(html, /\.terminal-header\{position:sticky;top:0;/);
  assert.match(
    html,
    /<header class="terminal-header"[\s\S]*Loading project context[\s\S]*Dependency resolution completed[\s\S]*Chapter resolved:[\s\S]*<\/header>/,
  );
  assert.match(html, /aria-label="章节导航"/);
  assert.match(html, /Alt\+PageUp/);
  assert.match(html, /第 37 章/);
  assert.match(html, /\.toolbar\{[^}]*opacity:0/);
  assert.match(html, /\.footer-nav\{[^}]*opacity:0/);
  assert.doesNotMatch(html, /<h1>/);
  assert.doesNotMatch(html, /text-indent:2em/);
  assert.match(html, /prefers-reduced-motion:reduce/);
});

test('empty reader explains how to open and navigate chapters', () => {
  const html = getEmptyHtml({}, { terminalPrompt: 'PS D:\\work>' });
  assert.match(html, /Waiting for chapter selection/);
  assert.match(html, /Alt\+PageUp \/ Alt\+PageDown/);
  assert.match(html, /PS D:\\work&gt;/);
});

test('terminal prompt follows the current platform and workspace', () => {
  assert.equal(
    createTerminalPrompt('D:\\work\\projects\\demo', 'win32'),
    'PS D:\\work\\projects\\demo>',
  );
  assert.equal(createTerminalPrompt('/work/demo', 'linux'), '/work/demo $');
});
