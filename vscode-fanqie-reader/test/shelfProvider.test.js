'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}

class EventEmitter {
  constructor() {
    this.event = () => ({ dispose() {} });
  }

  fire() {}
}

const vscodeMock = {
  EventEmitter,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') return vscodeMock;
  return originalLoad.call(this, request, parent, isMain);
};
const { BookItem, ShelfProvider } = require('../src/extension');
Module._load = originalLoad;

test('guest shelf offers reading first and an explicit account sync action', async () => {
  for (const hasCookie of [async () => false, async () => { throw new Error('storage unavailable'); }]) {
    const client = { hasCookie };
    const provider = new ShelfProvider({}, client);
    const items = await provider.getChildren();
    assert.deepEqual(items.map((item) => item.command?.command), [
      'fanqieReader.open', 'fanqieReader.login',
    ]);
    assert.equal(items[1].label, '登录并同步书架');
  }
});

test('shelf progressively replaces ID placeholders with cached book metadata', async () => {
  const ids = ['7636702239288986649', '7493943874184825918'];
  const state = {};
  let releaseHydration;
  let markHydrationDone;
  const hydrationGate = new Promise((resolve) => { releaseHydration = resolve; });
  const hydrationDone = new Promise((resolve) => { markHydrationDone = resolve; });
  const context = {
    globalState: {
      get: (key, fallback) => state[key] || fallback,
      update: async (key, value) => {
        state[key] = value;
        markHydrationDone();
      },
    },
  };
  const client = {
    hasCookie: async () => true,
    getUser: async () => ({ name: '测试账号' }),
    getShelfBookIds: async () => ids,
    getBookMetadataBatch: async (bookIds, options) => {
      assert.deepEqual(bookIds, ids);
      assert.equal(options.concurrency, 3);
      await hydrationGate;
      const rows = [
        { id: ids[0], name: '第一本书', author: '作者甲', chapterCount: 10 },
        { id: ids[1], name: '第二本书', author: '作者乙', chapterCount: 20 },
      ];
      for (const row of rows) await options.onMetadata(row);
      return rows;
    },
  };

  const provider = new ShelfProvider(context, client);
  const items = await provider.getChildren();
  const books = items.filter((item) => item instanceof BookItem);
  const manualOpen = items.find(
    (item) => item.command?.command === 'fanqieReader.open',
  );

  assert.deepEqual(books.map((book) => book.label), ids.map((id) => `书籍 ${id}`));
  assert.equal(manualOpen.label, '通过 ID 或链接打开…');

  releaseHydration();
  await hydrationDone;

  assert.deepEqual(books.map((book) => book.label), ['第一本书', '第二本书']);
  assert.deepEqual(books.map((book) => book.description), ['作者甲', '作者乙']);
  assert.equal(state['fanqieReader.bookMetadata'][ids[0]].chapterCount, 10);
});

test('shelf uses persisted metadata immediately on the next load', async () => {
  const id = '7636702239288986649';
  const context = {
    globalState: {
      get: (key, fallback) => key === 'fanqieReader.bookMetadata'
        ? { [id]: { id, name: '已缓存书名', author: '已缓存作者', chapterCount: 8 } }
        : fallback,
      update: async () => {},
    },
  };
  const client = {
    hasCookie: async () => true,
    getUser: async () => ({ name: '测试账号' }),
    getShelfBookIds: async () => [id],
    getBookMetadataBatch: async () => {
      throw new Error('cached metadata should not be requested again');
    },
  };

  const provider = new ShelfProvider(context, client);
  const items = await provider.getChildren();
  const book = items.find((item) => item instanceof BookItem);
  assert.equal(book.label, '已缓存书名');
  assert.equal(book.description, '已缓存作者');
  assert.match(book.tooltip, /8 章/);
});

test('shelf uses actual reading state instead of a web catalog lock, and updates existing chapter nodes', async () => {
  const chapter = { id: '123456789', title: '合成章节', locked: true };
  const book = { id: '987654321', name: '合成书', volumes: [{ name: '默认', chapters: [chapter] }] };
  let listener;
  let state;
  const client = { getBook: async () => book, getChapterState: () => state,
    onChapterStateChanged: callback => { listener = callback; return { dispose() {} }; } };
  const provider = new ShelfProvider({}, client);
  const [volume] = await provider.getChildren(new BookItem(book.id));
  const [node] = await provider.getChildren(volume);
  assert.equal(node.description, '');
  assert.equal(node.iconPath.id, 'file-text');
  assert.equal(node.command.arguments[0], chapter.id);
  const changed = [];
  provider.events.fire = node => changed.push(node);
  for (const [status, label, icon] of [['readable', '', 'file-text'], ['login', '需登录', 'lock'], ['error', '暂不可用', 'warning']]) {
    state = { id: chapter.id, bookId: book.id, status };
    listener(state);
    assert.equal(node.description, label);
    assert.equal(node.iconPath.id, icon);
    assert.equal(changed.at(-1), node);
  }
  state = undefined;
  listener({ bookId: book.id });
  assert.equal(node.description, '');
  provider.dispose();
});
