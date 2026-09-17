'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FanqieClient,
  extractChapterFont,
  getDefaultUserAgent,
  normalizeCookie,
  normalizeUserAgent,
  parseFanqieInput,
  parseInitialState,
  parseShelfBookIds,
} = require('../src/fanqieClient');

test('parseInitialState reads nested JSON and escaped braces', () => {
  const html = '<script>window.__INITIAL_STATE__={"page":{"bookName":"示例}书"},"reader":{}};</script>';
  assert.equal(parseInitialState(html).page.bookName, '示例}书');
});

test('authenticated page state accepts undefined fields without changing quoted text', () => {
  const content = '<p>undefined, :undefined, "undefined", \\ and }</p>';
  const html = '<script>window.__INITIAL_STATE__={"common":{"libra":undefined},'
    + '"optional":[undefined,{"value":undefined}],"reader":{"content":'
    + JSON.stringify(content) + '}};</script>';
  const state = parseInitialState(html);
  assert.equal(state.common.libra, null);
  assert.deepEqual(state.optional, [null, { value: null }]);
  assert.equal(state.reader.content, content);
});

test('page state still rejects executable expressions and malformed literals', () => {
  for (const value of ['undefined()', '(undefined)', 'undefinedValue', 'NaN', '(()=>0)()', '0undefined']) {
    assert.throws(() => parseInitialState('<script>window.__INITIAL_STATE__={"value":'
      + value + '};</script>'), { code: 'INVALID_STATE' });
  }
});

test('parseFanqieInput recognizes book IDs and links', () => {
  assert.deepEqual(parseFanqieInput('7665193065501445145'), {
    type: 'book',
    id: '7665193065501445145',
  });
  assert.deepEqual(parseFanqieInput('https://fanqienovel.com/page/7665193065501445145?x=1'), {
    type: 'book',
    id: '7665193065501445145',
  });
  assert.deepEqual(parseFanqieInput('https://fanqienovel.com/reader/7670031790517518872'), {
    type: 'chapter',
    id: '7670031790517518872',
  });
  assert.equal(parseFanqieInput('not-a-link'), null);
});

test('normalizeCookie strips copied header prefix and line breaks', () => {
  assert.equal(normalizeCookie(' Cookie: a=1;\r\n b=2 '), 'a=1; b=2');
});

test('parseShelfBookIds reads the captured bookshelf field and removes duplicates', () => {
  assert.deepEqual(parseShelfBookIds({
    code: 0,
    data: {
      book_list: null,
      book_list_info: null,
      book_shelf_info: [
        { book_id: '7636702239288986649' },
        { book_id: '7493943874184825918' },
        { book_id: '7636702239288986649' },
      ],
    },
  }), ['7636702239288986649', '7493943874184825918']);
});

test('default request user agent follows Windows and macOS', () => {
  assert.match(getDefaultUserAgent('win32'), /Windows NT 10\.0/);
  assert.match(getDefaultUserAgent('darwin'), /Macintosh; Intel Mac OS X/);
  assert.equal(normalizeUserAgent('Browser\r\nInjected'), 'Browser Injected');
});

test('login stores the browser user agent and mirrors browser bookshelf headers', async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  const values = new Map();
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    const payload = url.includes('/api/user/info/v2')
      ? { code: 0, data: { id: 'account-1', name: '测试账号' } }
      : {
          code: 0,
          data: { book_shelf_info: [{ book_id: '7636702239288986649' }] },
        };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  t.after(() => { global.fetch = originalFetch; });

  const client = new FanqieClient({
    get: async (key) => values.get(key),
    store: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  });
  const browserUserAgent = 'Mozilla/5.0 (Macintosh) TestBrowser/151';
  const user = await client.saveCookie('sessionid=secret', {
    userAgent: browserUserAgent,
  });

  assert.equal(user.id, 'account-1');
  assert.equal(values.get('fanqieReader.userAgent'), browserUserAgent);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers['User-Agent'], browserUserAgent);
  assert.equal(requests[1].options.headers['User-Agent'], browserUserAgent);
  assert.equal(requests[1].options.headers.Referer, 'https://fanqienovel.com/bookshelf');
  assert.equal(requests[1].options.headers.Accept, 'application/json, text/plain, */*');
});

test('book metadata resolves shelf labels without retaining the full catalog', async (t) => {
  const originalFetch = global.fetch;
  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    return new Response(
      '<script>window.__INITIAL_STATE__=' + JSON.stringify({
        page: {
          bookId: '7636702239288986649',
          bookName: '文字武侠',
          authorName: '测试作者',
          chapterTotal: 331,
          chapterListWithVolume: [['large catalog omitted by metadata result']],
        },
      }) + ';</script>',
      { status: 200 },
    );
  };
  t.after(() => { global.fetch = originalFetch; });

  const client = new FanqieClient({});
  const first = await client.getBookMetadata('7636702239288986649');
  const second = await client.getBookMetadata('7636702239288986649');

  assert.deepEqual(first, {
    id: '7636702239288986649',
    name: '文字武侠',
    author: '测试作者',
    chapterCount: 331,
    lastChapterTitle: '',
  });
  assert.equal(second, first);
  assert.equal(requestCount, 1);
  assert.equal('volumes' in first, false);
});

test('book metadata hydration is concurrency limited and continues after failures', async () => {
  const client = new FanqieClient({});
  const ids = [
    '7636702239288986649',
    '7493943874184825918',
    '7623686597409508376',
    '7511906104662576153',
    '7641906591557487640',
  ];
  let active = 0;
  let maximumActive = 0;
  const hydrated = [];
  const failed = [];
  client.getBookMetadata = async (id) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (id === ids[2]) throw new Error('temporary failure');
    return { id, name: `Book ${id}` };
  };

  const results = await client.getBookMetadataBatch(ids, {
    concurrency: 2,
    onMetadata: (metadata) => { hydrated.push(metadata.id); },
    onError: (id) => { failed.push(id); },
  });

  assert.equal(maximumActive, 2);
  assert.equal(results.length, 4);
  assert.equal(hydrated.length, 4);
  assert.deepEqual(failed, [ids[2]]);
});

test('extractChapterFont selects the reader regular woff2 font', () => {
  const html = [
    '<style>@font-face{font-family:abc123;font-display:block;',
    'src:url(https://font.example/chapter.woff2)format("woff2");font-weight:400;}</style>',
    '<div class="muye-reader-box font-abc123 muye-reader-content-16"></div>',
  ].join('');
  assert.deepEqual(extractChapterFont(html), {
    family: 'abc123',
    url: 'https://font.example/chapter.woff2',
  });
});

test('reading and fonts remain anonymous even when an account session is saved', async (t) => {
  const requests = [];
  const values = new Map([
    ['fanqieReader.cookie', 'sessionid=test-only'],
    ['fanqieReader.userAgent', 'TestBrowser/macOS'],
  ]);
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith('https://font.example/')) return new Response('font');
    return new Response('<script>window.__INITIAL_STATE__=' + JSON.stringify({
      reader: { chapterData: {
        itemId: '7670031790517518872',
        content: '<p>公开正文</p>',
        isChapterLock: false,
      } },
    }) + ';</script><style>@font-face{font-family:test;src:url(https://font.example/test.woff2);font-weight:400;}</style>'
      + '<div class="muye-reader-box font-test"></div>');
  });
  let secretReads = 0;
  const client = new FanqieClient({ get: async (key) => {
    secretReads += 1;
    return values.get(key);
  } });
  const chapter = await client.getChapter('7670031790517518872');
  assert.equal(chapter.locked, false);
  assert.equal(chapter.content, '<p>公开正文</p>');
  assert.equal(secretReads, 0);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.Cookie, undefined);
  assert.equal(requests[0].options.headers['User-Agent'], getDefaultUserAgent());
  assert.equal(requests[1].options.headers['User-Agent'], getDefaultUserAgent());
  assert.equal(requests[1].options.headers.Cookie, undefined);
});

test('anonymous chapters remain readable and server lock flags remain authoritative', async (t) => {
  let locked = false;
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(options.headers.Cookie, undefined);
    assert.match(url, /\/reader\//); // Locked content must not trigger a font request.
    return new Response('<script>window.__INITIAL_STATE__=' + JSON.stringify({
      reader: { chapterData: {
        itemId: '7670031790517518872', content: '<p>示例</p>', isChapterLock: locked,
      } },
    }) + ';</script>' + (locked
      ? '<style>@font-face{font-family:test;src:url(https://font.example/test.woff2);font-weight:400;}</style><div class="muye-reader-box font-test"></div>'
      : ''));
  });
  const client = new FanqieClient({ get: async () => undefined });
  assert.equal((await client.getChapter('7670031790517518872')).locked, false);
  locked = true;
  const chapter = await client.getChapter('7670031790517518872');
  assert.equal(chapter.locked, true);
  assert.equal(chapter.fontDataUri, '');
});

test('web-only inspection retains its chapter lock without invoking the mobile client', async (t) => {
  t.mock.method(global, 'fetch', async () => new Response(
    '<script>window.__INITIAL_STATE__=' + JSON.stringify({ reader: { chapterData: {
      itemId: '7175147347041911356', bookId: '7143038691944959011',
      title: '第11章 继续吧', chapterWordNumber: '2321',
      needPay: 0, isChapterLock: true, isPaidPublication: false, isPaidStory: false,
      content: '<p>合成试读内容，不包含原文。</p>',
    } } }) + ';</script>',
  ));
  const client = new FanqieClient({ get: async () => undefined }, { mobile: false });
  const chapter = await client.getChapter('7175147347041911356');
  assert.equal(chapter.locked, true);
  assert.equal(chapter.wordCount, 2321);
});

test('restricted reading retries once with the saved account and keeps its Cookie off the font CDN', async (t) => {
  const requests = [];
  const values = new Map([
    ['fanqieReader.cookie', 'sessionid=synthetic-account'],
    ['fanqieReader.userAgent', 'SyntheticBrowser/macOS'],
  ]);
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith('https://font.example/')) return new Response('font');
    const loggedIn = Boolean(options.headers.Cookie);
    return new Response('<script>window.__INITIAL_STATE__=' + JSON.stringify({
      reader: { chapterData: {
        itemId: '7175147347041911356',
        content: loggedIn ? '<p>合成账号可读正文</p>' : '<p>合成试读</p>',
        isChapterLock: !loggedIn,
      } },
    }) + ';</script><style>@font-face{font-family:test;src:url(https://font.example/account.woff2);font-weight:400;}</style>'
      + '<div class="muye-reader-box font-test"></div>');
  });
  const client = new FanqieClient({ get: async (key) => values.get(key) });
  const chapter = await client.getChapter('7175147347041911356');
  assert.equal(chapter.locked, false);
  assert.equal(chapter.content, '<p>合成账号可读正文</p>');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].options.headers.Cookie, undefined);
  assert.equal(requests[1].options.headers.Cookie, values.get('fanqieReader.cookie'));
  assert.equal(requests[1].options.headers['User-Agent'], 'SyntheticBrowser/macOS');
  assert.equal(requests[2].options.headers['User-Agent'], 'SyntheticBrowser/macOS');
  assert.equal(requests[2].options.headers.Cookie, undefined);

  values.clear();
  requests.length = 0;
  assert.equal((await client.getChapter('7175147347041911356')).locked, true);
  assert.equal(requests.length, 1); // Logging out removes access; no body is cached.
});

test('an optional account failure never clears a server lock or loops', async (t) => {
  for (const failure of ['still_locked', 'expired', 'network', 'invalid_page', 'different_chapter', 'storage']) {
    await t.test(failure, async (t) => {
      const requests = [];
      t.mock.method(global, 'fetch', async (_url, options) => {
        requests.push(options);
        const accountRequest = Boolean(options.headers.Cookie);
        if (accountRequest && failure === 'expired') return new Response('', { status: 401 });
        if (accountRequest && failure === 'network') throw new Error('synthetic network error');
        if (accountRequest && failure === 'invalid_page') return new Response('<html>Login</html>');
        return new Response('<script>window.__INITIAL_STATE__=' + JSON.stringify({
          reader: { chapterData: {
            itemId: accountRequest && failure === 'different_chapter' ? '1111111111111111111' : '7175147347041911356',
            content: accountRequest ? '<p>合成账号响应</p>' : '<p>合成试读</p>',
            isChapterLock: !(accountRequest && failure === 'different_chapter'),
          } },
        }) + ';</script>');
      });
      const client = new FanqieClient({ get: async () => {
        if (failure === 'storage') throw new Error('secret storage unavailable');
        return 'synthetic-session';
      } });
      const chapter = await client.getChapter('7175147347041911356');
      assert.equal(chapter.locked, true);
      assert.equal(chapter.content, failure === 'still_locked' ? '<p>合成账号响应</p>' : '<p>合成试读</p>');
      assert.equal(requests.length, failure === 'storage' ? 1 : 2);
    });
  }
});

test('restricted chapters stay on the website and offer login without loading a mobile runtime', async t => {
  const web = { itemId: '7175147347041911356', bookId: '7143038691944959011', isChapterLock: true, content: '<p>预览</p>' };
  t.mock.method(global, 'fetch', async url => {
    assert.equal(new URL(url).hostname, 'fanqienovel.com');
    return new Response('<script>window.__INITIAL_STATE__=' + JSON.stringify({ reader: { chapterData: web } }) + ';</script>');
  });
  const Module = require('node:module');
  const load = Module._load;
  t.mock.method(Module, '_load', function (request, ...args) {
    assert.doesNotMatch(request, /mobileClient|mobileRuntime/);
    return load.call(this, request, ...args);
  });
  const client = new FanqieClient({ get: async () => undefined });
  const chapter = await client.getChapter(web.itemId);
  assert.equal(chapter.locked, true);
  assert.equal(chapter.loginRequired, true);
  assert.equal(chapter.source, 'web');
});

test('member HTML with undefined metadata opens in the client and diagnostics omit credentials and content', async t => {
  const id = '7175147347041911356';
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(new URL(url).hostname, 'fanqienovel.com');
    const account = Boolean(options.headers.Cookie);
    return new Response('<script>window.__INITIAL_STATE__={"common":{"libra":'
      + (account ? 'undefined' : 'null') + '},"reader":{"chapterData":'
      + JSON.stringify({ itemId: id, isChapterLock: !account, content: account ? '<p>MEMBER_BODY</p>' : '<p>PREVIEW</p>' }) + '}};</script>');
  });
  const client = new FanqieClient({ get: async () => 'synthetic-secret' });
  const chapter = await client.getChapter(id);
  assert.equal(chapter.locked, false);
  assert.equal(chapter.content, '<p>MEMBER_BODY</p>');
  const diagnostics = client.getReadingDiagnostics();
  assert.deepEqual(diagnostics.requests.map(r => [r.mode, r.result]), [['guest', 'restricted'], ['account', 'readable']]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /synthetic-secret|MEMBER_BODY|PREVIEW|7175147347041911356/);
});

test('catalog order restores missing navigation, including volume boundaries and first/last chapters', async t => {
  const ids = ['1111111111111111111', '2222222222222222222', '3333333333333333333'];
  const bookId = '9999999999999999999';
  t.mock.method(global, 'fetch', async url => {
    const id = url.split('/').at(-1);
    return new Response('<script>window.__INITIAL_STATE__=' + JSON.stringify({ reader: { chapterData: {
      itemId: id, bookId, isChapterLock: false, content: '<p>正文</p>', preItemId: '0', nextItemId: '-1',
    } } }) + ';</script>');
  });
  const client = new FanqieClient({});
  let loads = 0;
  client.getBook = async () => {
    loads++;
    const book = { id: bookId, chapters: ids.map(id => ({ id, order: 0 })) };
    client.bookCache.set(bookId, book);
    return book;
  };
  const states = [];
  const subscription = client.onChapterStateChanged(state => states.push(state));
  for (let index = 0; index < ids.length; index++) {
    const chapter = await client.getChapter(ids[index]);
    assert.equal(chapter.previousItemId, ids[index - 1] || '');
    assert.equal(chapter.nextItemId, ids[index + 1] || '');
    assert.equal(chapter.order, index + 1);
    assert.equal(client.getChapterState(ids[index]).status, 'readable');
  }
  assert.equal(loads, 1);
  assert.equal(states.length, 3);
  subscription.dispose();
});
