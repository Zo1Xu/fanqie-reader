'use strict';

const vscode = require('vscode');
const { FanqieClient, parseFanqieInput } = require('./fanqieClient');
const { LoginViewProvider } = require('./loginView');
const { OfficialLogin } = require('./officialLogin');
const { READER_VIEW_ID, ReaderPanel } = require('./readerPanel');

let activeOfficialLogin;

class ShelfProvider {
  constructor(context, client) {
    this.context = context;
    this.client = client;
    this.events = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.events.event;
    this.bookNodes = new Map();
  }

  refresh(element) {
    if (!element) {
      this.client.clearCache();
      this.bookNodes.clear();
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
      return element.chapters.map((chapter) => new ChapterItem(chapter));
    }
    if (element) {
      return [];
    }
    return this.#getRootItems();
  }

  async #getRootItems() {
    const items = [
      new ActionItem('打开书籍或章节…', 'book', 'fanqieReader.open'),
    ];
    if (!(await this.client.hasCookie())) {
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
      for (const id of bookIds) {
        const cached = history[id];
        const node = new BookItem(id, cached?.bookName, cached?.author, cached?.title);
        this.bookNodes.set(id, node);
        items.push(node);
      }
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

  updateProgress(bookId) {
    const node = this.bookNodes.get(bookId);
    const history = this.context.globalState.get('fanqieReader.history', {})[bookId];
    if (node && history) {
      node.description = history.title;
      node.tooltip = `${node.label}\n上次读到：${history.title}`;
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
  constructor(bookId, name, author, progressTitle) {
    super(name || `书籍 ${bookId}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.bookId = bookId;
    this.book = undefined;
    this.description = progressTitle || author || '';
    this.tooltip = name
      ? `${name}${author ? ` · ${author}` : ''}${progressTitle ? `\n上次读到：${progressTitle}` : ''}`
      : `番茄书籍 ID：${bookId}\n展开后载入详情和目录`;
    this.iconPath = new vscode.ThemeIcon('book');
    this.contextValue = 'fanqieBook';
    this.command = {
      command: 'fanqieReader.continueBook',
      title: '继续阅读',
      arguments: [this],
    };
  }

  applyBook(book) {
    this.book = book;
    this.label = book.name;
    this.description = book.author;
    this.tooltip = `${book.name}${book.author ? ` · ${book.author}` : ''}\n${book.chapterCount} 章`;
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
  constructor(chapter) {
    super(chapter.title, vscode.TreeItemCollapsibleState.None);
    this.chapter = chapter;
    this.description = chapter.locked ? '已锁定' : '';
    this.iconPath = new vscode.ThemeIcon(chapter.locked ? 'lock' : 'file-text');
    this.contextValue = 'fanqieChapter';
    this.command = {
      command: 'fanqieReader.openChapter',
      title: '阅读章节',
      arguments: [chapter.id],
    };
  }
}

async function activate(context) {
  const client = new FanqieClient(context.secrets);
  const officialLogin = new OfficialLogin(client);
  activeOfficialLogin = officialLogin;
  let shelfProvider;
  const reader = new ReaderPanel(context, client, (bookId) => {
    shelfProvider?.updateProgress(bookId);
  });
  shelfProvider = new ShelfProvider(context, client);
  const setLoggedIn = (value) =>
    vscode.commands.executeCommand('setContext', 'fanqieReader.loggedIn', Boolean(value));
  const loginViewProvider = new LoginViewProvider(context, officialLogin, {
    onLoggedIn: async (user) => {
      await setLoggedIn(true);
      shelfProvider.refresh();
      vscode.window.showInformationMessage(
        `番茄阅读：已登录 ${user.name || '番茄小说账号'}，书架正在刷新。`,
      );
    },
  });
  await setLoggedIn(await client.hasCookie());

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('fanqieReader.shelf', shelfProvider),
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
        await setLoggedIn(false);
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
        vscode.window.showInformationMessage(
          `番茄阅读：已登录 ${user.name || '番茄小说账号'}，书架正在刷新。`,
        );
        await setLoggedIn(true);
        shelfProvider.refresh();
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
        vscode.window.showInformationMessage(`番茄阅读：已登录 ${user.name || '番茄小说账号'}`);
        await setLoggedIn(true);
        shelfProvider.refresh();
      }),
    ),
    vscode.commands.registerCommand('fanqieReader.clearCookie', () =>
      runWithErrorHandling(async () => {
        if (!(await client.hasCookie())) {
          vscode.window.showInformationMessage('番茄阅读：当前未登录。');
          return;
        }
        const choice = await vscode.window.showWarningMessage(
          '确定要退出番茄小说账号吗？本地阅读进度会保留。',
          { modal: true },
          '退出登录',
        );
        if (choice !== '退出登录') {
          return;
        }
        await client.clearCookie();
        loginViewProvider.cancel();
        await setLoggedIn(false);
        shelfProvider.refresh();
        vscode.window.showInformationMessage('番茄阅读：已退出登录。');
      }),
    ),
  );
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
      title: '打开番茄小说',
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
  await activeOfficialLogin?.cancelPhoneLogin();
  activeOfficialLogin = undefined;
}

module.exports = { activate, deactivate };
