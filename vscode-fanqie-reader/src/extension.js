'use strict';

const vscode = require('vscode');
const { FanqieClient, parseFanqieInput } = require('./fanqieClient');
const { LoginViewProvider } = require('./loginView');
const { OfficialLogin } = require('./officialLogin');
const { READER_VIEW_ID, ReaderPanel } = require('./readerPanel');

const BOOK_METADATA_STATE_KEY = 'fanqieReader.bookMetadata';
const BOOK_METADATA_CONCURRENCY = 3;
const LEGACY_EXTENSION_ID = 'local.fanqie-reader';
const CURRENT_EXTENSION_ACTIVE_CONTEXT = 'fanqieReader.currentExtensionActive';
let activeOfficialLogin;
let activeClient;

class ShelfProvider {
  constructor(context, client) {
    this.context = context;
    this.client = client;
    this.events = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.events.event;
    this.bookNodes = new Map();
    this.hydratingBookIds = new Set();
    this.chapterNodes = new Map();
    this.chapterSubscription = client.onChapterStateChanged?.(state => {
      for (const node of this.chapterNodes.values()) {
        if (node.bookId === state.bookId) {
          node.applyReadState(this.client.getChapterState(node.chapter.id));
          this.events.fire(node);
        }
      }
    });
  }

  dispose() { this.chapterSubscription?.dispose(); this.events.dispose?.(); }

  refresh(element) {
    if (!element) {
      this.client.clearCache();
      this.bookNodes.clear();
      this.chapterNodes.clear();
    }
    this.events.fire(element);
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (element instanceof BookItem) {
      return this.#getBookVolumes(element);
    }
    if (element instanceof VolumeItem) {
      return element.chapters.map(chapter => {
        const node = new ChapterItem(chapter, element.book.id, this.client.getChapterState?.(chapter.id));
        this.chapterNodes.set(chapter.id, node);
        return node;
      });
    }
    if (element) {
      return [];
    }
    return this.#getRootItems();
  }

  async #getRootItems() {
    const items = [
      new ActionItem('通过 ID 或链接打开…', 'book', 'fanqieReader.open'),
    ];
    if (!(await this.client.hasCookie().catch(() => false))) {
      items.push(new ActionItem('登录并同步书架', 'sign-in', 'fanqieReader.login'));
      return items;
    }

    try {
      const [user, bookIds] = await Promise.all([
        this.client.getUser(),
        this.client.getShelfBookIds(),
      ]);
      items.unshift(
        new AccountItem(user.name || '已登录'),
        new ActionItem('退出登录', 'sign-out', 'fanqieReader.clearCookie'),
      );
      if (!bookIds.length) {
        items.push(new MessageItem('书架为空', 'info'));
        return items;
      }
      const history = this.context.globalState.get('fanqieReader.history', {});
      const storedMetadata = this.context.globalState.get(BOOK_METADATA_STATE_KEY, {});
      const missingMetadataIds = [];
      for (const id of bookIds) {
        const cachedHistory = history[id];
        const cachedMetadata = storedMetadata[id] || {};
        const node = new BookItem(id, {
          name: cachedHistory?.bookName || cachedMetadata.name,
          author: cachedHistory?.author || cachedMetadata.author,
          chapterCount: cachedMetadata.chapterCount,
        }, cachedHistory?.title);
        this.bookNodes.set(id, node);
        items.push(node);
        if (!cachedMetadata.name) {
          missingMetadataIds.push(id);
        }
      }
      void this.#hydrateBookMetadata(missingMetadataIds);
    } catch (error) {
      items.push(new MessageItem(error.message, 'warning'));
      items.push(new ActionItem('重新登录番茄小说', 'sign-in', 'fanqieReader.login'));
    }
    return items;
  }

  async #getBookVolumes(item) {
    item.busy = true;
    try {
      const book = await this.client.getBook(item.bookId);
      item.applyBook(book);
      this.events.fire(item);
      if (!book.volumes.length) {
        return [new MessageItem('暂无章节', 'info')];
      }
      return book.volumes.map((volume) => new VolumeItem(book, volume));
    } catch (error) {
      return [new MessageItem(error.message, 'warning')];
    } finally {
      item.busy = false;
    }
  }

  async #hydrateBookMetadata(bookIds) {
    const pendingIds = bookIds.filter((id) => {
      if (this.hydratingBookIds.has(id)) return false;
      this.hydratingBookIds.add(id);
      return true;
    });
    if (!pendingIds.length) return;

    try {
      const metadataRows = await this.client.getBookMetadataBatch(pendingIds, {
        concurrency: BOOK_METADATA_CONCURRENCY,
        onMetadata: (metadata) => {
          const node = this.bookNodes.get(metadata.id);
          if (node) {
            node.applyMetadata(metadata);
            this.events.fire(node);
          }
        },
      });
      if (metadataRows.length) {
        const storedMetadata = {
          ...this.context.globalState.get(BOOK_METADATA_STATE_KEY, {}),
        };
        const updatedAt = Date.now();
        for (const metadata of metadataRows) {
          storedMetadata[metadata.id] = { ...metadata, updatedAt };
        }
        await this.context.globalState.update(BOOK_METADATA_STATE_KEY, storedMetadata);
      }
    } catch {
      // Individual failures leave an ID placeholder and can be retried by refresh.
    } finally {
      for (const id of pendingIds) {
        this.hydratingBookIds.delete(id);
      }
    }
  }

  updateProgress(bookId) {
    const node = this.bookNodes.get(bookId);
    const history = this.context.globalState.get('fanqieReader.history', {})[bookId];
    if (node && history) {
      node.applyProgress(history);
      this.events.fire(node);
    }
  }
}

class ActionItem extends vscode.TreeItem {
  constructor(label, icon, command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = { command, title: label };
    this.contextValue = 'fanqieAction';
  }
}

class AccountItem extends vscode.TreeItem {
  constructor(name) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.description = '已登录';
    this.iconPath = new vscode.ThemeIcon('account');
    this.contextValue = 'fanqieAccount';
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(label, icon) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = 'fanqieMessage';
  }
}

class BookItem extends vscode.TreeItem {
  constructor(bookId, metadata = {}, progressTitle = '') {
    super(metadata.name || `书籍 ${bookId}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.bookId = bookId;
    this.book = undefined;
    this.name = String(metadata.name || '');
    this.author = String(metadata.author || '');
    this.chapterCount = Number(metadata.chapterCount || 0);
    this.progressTitle = String(progressTitle || '');
    this.#updatePresentation();
    this.iconPath = new vscode.ThemeIcon('book');
    this.contextValue = 'fanqieBook';
    this.command = {
      command: 'fanqieReader.continueBook',
      title: '继续阅读',
      arguments: [this],
    };
  }

  applyMetadata(metadata) {
    this.name = String(metadata?.name || this.name || '');
    this.author = String(metadata?.author || this.author || '');
    this.chapterCount = Number(metadata?.chapterCount || this.chapterCount || 0);
    this.#updatePresentation();
  }

  applyBook(book) {
    this.book = book;
    this.applyMetadata(book);
  }

  applyProgress(history) {
    this.progressTitle = String(history?.title || '');
    this.name = String(history?.bookName || this.name || '');
    this.author = String(history?.author || this.author || '');
    this.#updatePresentation();
  }

  #updatePresentation() {
    this.label = this.name || `书籍 ${this.bookId}`;
    this.description = this.progressTitle || this.author || (this.name ? '' : '正在获取书名…');
    if (!this.name) {
      this.tooltip = `番茄书籍 ID：${this.bookId}\n正在后台载入书名和作者`;
      return;
    }
    this.tooltip = `${this.name}${this.author ? ` · ${this.author}` : ''}` +
      `${this.progressTitle ? `\n上次读到：${this.progressTitle}` : ''}` +
      `${this.chapterCount ? `\n${this.chapterCount} 章` : ''}`;
  }
}

class VolumeItem extends vscode.TreeItem {
  constructor(book, volume) {
    super(volume.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.book = book;
    this.chapters = volume.chapters;
    this.description = `${volume.chapters.length} 章`;
    this.iconPath = new vscode.ThemeIcon('library');
    this.contextValue = 'fanqieVolume';
  }
}

class ChapterItem extends vscode.TreeItem {
  constructor(chapter, bookId, state) {
    super(chapter.title, vscode.TreeItemCollapsibleState.None);
    this.chapter = chapter;
    this.bookId = bookId;
    this.id = `chapter:${bookId}:${chapter.id}`;
    this.applyReadState(state);
    this.contextValue = 'fanqieChapter';
    this.command = {
      command: 'fanqieReader.openChapter',
      title: '阅读章节',
      arguments: [chapter.id],
    };
  }

  applyReadState(state) {
    const status = state?.status;
    this.description = status === 'login' ? '需登录' : status === 'restricted' ? '阅读受限' : status === 'error' ? '暂不可用' : '';
    this.iconPath = new vscode.ThemeIcon(status === 'login' || status === 'restricted' ? 'lock' : status === 'error' ? 'warning' : 'file-text');
    this.tooltip = `${this.chapter.title}\n${state?.reason || (status === 'readable' ? '已读取完整正文' : '点击读取正文')}`;
  }
}

async function activate(context) {
  if (await guardAgainstLegacyInstallation()) {
    return;
  }

  const client = new FanqieClient(context.secrets);
  activeClient = client;
  context.subscriptions.push({ dispose: () => client.dispose() });
  const officialLogin = new OfficialLogin(client);
  activeOfficialLogin = officialLogin;
  let shelfProvider;
  const reader = new ReaderPanel(context, client, (bookId) => {
    shelfProvider?.updateProgress(bookId);
  });
  shelfProvider = new ShelfProvider(context, client);
  context.subscriptions.push(shelfProvider);
  const setLoggedIn = async (value) => {
    await vscode.commands.executeCommand('setContext', 'fanqieReader.loggedIn', Boolean(value));
    await vscode.commands.executeCommand('setContext', 'fanqieReader.loginRequested', false);
  };
  const onLoggedIn = async (user) => {
    await setLoggedIn(true);
    shelfProvider.refresh();
    vscode.window.showInformationMessage(
      `番茄阅读：已登录 ${user.name || '番茄小说账号'}，书架正在刷新。`,
    );
    // Reading failure must not turn a successful account login into a login error.
    void runWithErrorHandling(() => reader.retryRestrictedChapter());
  };
  const loginViewProvider = new LoginViewProvider(context, officialLogin, {
    onLoggedIn,
    onDismiss: () => vscode.commands.executeCommand('setContext', 'fanqieReader.loginRequested', false),
  });
  await setLoggedIn(await client.hasCookie().catch(() => false));

  context.subscriptions.push(
    createShelfTree(shelfProvider),
    vscode.window.registerWebviewViewProvider(
      READER_VIEW_ID,
      reader,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      'fanqieReader.loginView',
      loginViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('fanqieReader.refresh', () => shelfProvider.refresh()),
    vscode.commands.registerCommand('fanqieReader.copyReadingDiagnostics', () =>
      runWithErrorHandling(async () => {
        await vscode.env.clipboard.writeText(JSON.stringify({ extensionVersion: context.extension?.packageJSON?.version,
          ...client.getReadingDiagnostics() }, null, 2));
        vscode.window.showInformationMessage('番茄阅读：诊断已复制，不包含账号、Cookie、设备标识或正文。');
      }),
    ),
    vscode.commands.registerCommand('fanqieReader.openChapter', (itemId) =>
      runWithErrorHandling(() => reader.openChapter(itemId)),
    ),
    vscode.commands.registerCommand('fanqieReader.open', (value) =>
      runWithErrorHandling(() => openFromInput(value, client, reader)),
    ),
    vscode.commands.registerCommand('fanqieReader.continueBook', (item) =>
      runWithErrorHandling(async () => {
        const book = item?.book || (item?.bookId ? await client.getBook(item.bookId) : undefined);
        if (!book) {
          return openFromInput(undefined, client, reader);
        }
        item?.applyBook?.(book);
        if (item instanceof BookItem) {
          shelfProvider.refresh(item);
        }
        await reader.continueBook(book);
      }),
    ),
    vscode.commands.registerCommand('fanqieReader.showReader', () =>
      runWithErrorHandling(() => reader.show()),
    ),
    vscode.commands.registerCommand('fanqieReader.previousChapter', () =>
      runWithErrorHandling(() => reader.previousChapter()),
    ),
    vscode.commands.registerCommand('fanqieReader.nextChapter', () =>
      runWithErrorHandling(() => reader.nextChapter()),
    ),
    vscode.commands.registerCommand('fanqieReader.login', () =>
      runWithErrorHandling(async () => {
        await vscode.commands.executeCommand('setContext', 'fanqieReader.loginRequested', true);
        await loginViewProvider.focus();
      }),
    ),
    vscode.commands.registerCommand('fanqieReader.loginInBrowser', () =>
      runWithErrorHandling(async () => {
        loginViewProvider.cancel();
        const browserPath = vscode.workspace
          .getConfiguration('fanqieReader')
          .get('browserPath', '');
        const user = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '番茄阅读：官方登录',
            cancellable: true,
          },
          (progress, cancellationToken) =>
            officialLogin.login({
              browserPath,
              cancellationToken,
              onStatus: (message) => progress.report({ message }),
            }),
        );
        await onLoggedIn(user);
      }),
    ),
    vscode.commands.registerCommand('fanqieReader.setCookie', () =>
      runWithErrorHandling(async () => {
        const value = await vscode.window.showInputBox({
          title: '手动导入番茄小说 Cookie（高级）',
          prompt: '通常无需使用此功能。Cookie 只保存在 VS Code SecretStorage 中。',
          placeHolder: '粘贴 Cookie 请求头的值',
          password: true,
          ignoreFocusOut: true,
        });
        if (value === undefined) {
          return;
        }
        const user = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: '正在验证番茄小说登录状态…' },
          () => client.saveCookie(value),
        );
        await onLoggedIn(user);
      }),
    ),
    vscode.commands.registerCommand('fanqieReader.clearCookie', () =>
      runWithErrorHandling(async () => {
        const result = await runLogout({
          client,
          confirm: async () => {
            const choice = await vscode.window.showWarningMessage(
              '确定要退出番茄小说账号吗？本地阅读进度会保留。',
              { modal: true },
              '退出登录',
            );
            return choice === '退出登录';
          },
          onLoggedOut: async () => {
            loginViewProvider.cancel();
            await setLoggedIn(false);
            shelfProvider.refresh();
            await context.globalState.update(BOOK_METADATA_STATE_KEY, undefined);
          },
        });
        if (!result.completed) {
          return;
        }
        vscode.window.showInformationMessage(
          result.hadCookie
            ? '番茄阅读：已退出登录。'
            : '番茄阅读：登录状态已清理。',
        );
      }),
    ),
  );
}

function createShelfTree(shelfProvider, api = vscode) {
  return api.window.createTreeView('fanqieReader.shelf', {
    treeDataProvider: shelfProvider,
    showCollapseAll: true,
  });
}

async function guardAgainstLegacyInstallation(api = vscode) {
  const legacyExtension = api.extensions?.getExtension?.(LEGACY_EXTENSION_ID);
  await api.commands.executeCommand(
    'setContext',
    CURRENT_EXTENSION_ACTIVE_CONTEXT,
    !legacyExtension,
  );
  if (!legacyExtension) {
    return false;
  }

  const action = await api.window.showWarningMessage(
    '检测到旧测试版 local.fanqie-reader。它会与当前版重复注册侧栏按钮，并使登录数据分属两个扩展。请卸载旧测试版后重新加载窗口。',
    '管理旧测试版',
  );
  if (action === '管理旧测试版') {
    await api.commands.executeCommand(
      'workbench.extensions.search',
      `@id:${LEGACY_EXTENSION_ID}`,
    );
  }
  return true;
}

async function runLogout({ client, confirm, onLoggedOut }) {
  const hadCookie = await client.hasCookie();
  if (hadCookie && !(await confirm())) {
    return { completed: false, hadCookie: true };
  }

  // Clearing is intentionally idempotent: a stale tree can still look logged in
  // after SecretStorage has already lost its cookie, so the UI must be reconciled.
  await client.clearCookie();
  await onLoggedOut();
  return { completed: true, hadCookie };
}

async function openFromInput(value, client, reader) {
  let parsed;
  if (value instanceof BookItem) {
    parsed = { type: 'book', id: value.bookId };
  } else if (typeof value === 'string') {
    parsed = parseFanqieInput(value);
  }
  if (!parsed) {
    const input = await vscode.window.showInputBox({
      title: '通过 ID 或链接打开番茄小说',
      prompt: '输入书籍 ID、书籍详情页链接或章节阅读页链接。',
      placeHolder: 'https://fanqienovel.com/page/…',
      ignoreFocusOut: true,
    });
    if (!input) {
      return;
    }
    parsed = parseFanqieInput(input);
  }
  if (!parsed) {
    throw new Error('无法识别该 ID 或链接。');
  }
  if (parsed.type === 'chapter') {
    await reader.openChapter(parsed.id);
    return;
  }
  const book = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: '正在载入番茄小说目录…' },
    () => client.getBook(parsed.id),
  );
  await reader.continueBook(book);
}

async function runWithErrorHandling(task) {
  try {
    await task();
  } catch (error) {
    if (error?.code === 'LOGIN_CANCELLED') {
      return;
    }
    vscode.window.showErrorMessage(`番茄阅读：${error.message}`);
  }
}

async function deactivate() {
  activeClient?.dispose();
  activeClient = undefined;
  await activeOfficialLogin?.cancelPhoneLogin();
  activeOfficialLogin = undefined;
}

module.exports = {
  activate,
  deactivate,
  BookItem,
  ShelfProvider,
  createShelfTree,
  guardAgainstLegacyInstallation,
  runLogout,
};
