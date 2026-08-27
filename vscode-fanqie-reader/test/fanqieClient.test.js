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
