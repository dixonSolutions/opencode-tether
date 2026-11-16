import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { OpencodeClient } from '../src/lib/api/client';
import { updateTranscript, reconcileTranscript } from '../src/lib/state/transcript';
import type { MessageWithParts, TetherEvent } from '../src/lib/api/types';
import { mockBackend, seed } from './helpers';

const message = (id = 'msg_live', text = ''): MessageWithParts => ({
  info: { id, sessionID: 'ses_one', role: 'assistant', time: { created: 1 }, agent: 'build' },
  parts: [{ id: `part_${id}`, messageID: id, sessionID: 'ses_one', type: 'text', text }]
});
const delta = (text: string): TetherEvent => ({ type: 'message.part.delta', properties: {
  sessionID: 'ses_one', messageID: 'msg_live', partID: 'part_msg_live', field: 'text', delta: text
} });

test('SSE cancellation survives headers and CRLF split across network chunks', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"server.connected","properties":{}}\r');
    setTimeout(() => res.write('\n\r\n'), 20);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const client = new OpencodeClient(`http://127.0.0.1:${address.port}`);
    const abort = new AbortController();
    const stream = client.stream('/event', abort.signal);
    expect((await stream.next()).value?.type).toBe('server.connected');
    const pending = stream.next();
    await new Promise((resolve) => setTimeout(resolve, 10));
    abort.abort();
    await expect(pending).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('burst deltas retain order and stale snapshots cannot roll back live text or deletions', () => {
  const baseline = [message('msg_live', 'start')];
  const events = Array.from({ length: 10_000 }, (_, i) => delta(`${i},`));
  const live = updateTranscript(baseline, events, 'ses_one');
  expect(live[0].parts[0]).toMatchObject({ text: 'start' + Array.from({ length: 10_000 }, (_, i) => `${i},`).join('') });
  expect(reconcileTranscript(baseline, baseline, live)).toEqual(live);
  expect(reconcileTranscript(baseline, baseline, [])).toEqual([]);
  const removed = updateTranscript(live, [{ type: 'message.part.removed', properties: { sessionID: 'ses_one', messageID: 'msg_live', partID: 'part_msg_live' } }], 'ses_one');
  expect(reconcileTranscript(baseline, live, removed)[0].parts).toEqual([]);
});

async function installStream(page: Page, globalMissing = false) {
  await page.addInitScript(({ globalMissing }) => {
    const original = window.fetch;
    const state = { opens: 0, paths: [] as string[], streams: [] as ReadableStreamDefaultController<Uint8Array>[], aborted: 0 };
    Object.assign(window, { tetherStream: state });
    window.fetch = async (input, init) => {
      if (new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).pathname.match(/^\/(global\/)?event$/) === null) return original(input, init);
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      state.paths.push(url.pathname + url.search);
      if (globalMissing && url.pathname === '/global/event') return new Response('', { status: 404 });
      state.opens++;
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        state.streams.push(controller);
        controller.enqueue(new TextEncoder().encode('data: {"type":"server.connected","properties":{}}\n\n'));
        init?.signal?.addEventListener('abort', () => { state.aborted++; controller.error(new DOMException('Aborted', 'AbortError')); });
      } });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  }, { globalMissing });
}

async function emit(page: Page, events: TetherEvent[]) {
  await page.evaluate((events) => {
    const state = (window as unknown as { tetherStream: { streams: ReadableStreamDefaultController<Uint8Array>[] } }).tetherStream;
    state.streams.at(-1)!.enqueue(new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify({ directory: '/home/test', payload: event })}\n\n`).join('')));
  }, events);
}

async function openStreaming(page: Page, baseURL: string, globalMissing = false) {
  await mockBackend(page);
  await seed(page, baseURL);
  await page.addInitScript(() => {
    const key = 'opencode-tether.store.v1';
    const data = JSON.parse(localStorage.getItem(key)!);
    data.settings.autoReconnect = true;
    localStorage.setItem(key, JSON.stringify(data));
  });
  await installStream(page, globalMissing);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Polish the interface' })).toBeVisible();
  await expect(page.locator('[data-message-id="msg_assistant"]')).toBeVisible();
}

test('live burst remains responsive and EOF reconnect resyncs missed output without duplication', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!);
  const info = message().info;
  await emit(page, [
    { type: 'session.status', properties: { sessionID: 'ses_one', status: { type: 'busy' } } },
    { type: 'message.updated', properties: { info } },
    { type: 'message.part.updated', properties: { part: message().parts[0] } },
    ...Array.from({ length: 1500 }, () => delta('token ')),
    delta('STREAM FINISHED')
  ]);
  await expect(page.locator('[data-message-id="msg_live"]')).toContainText('STREAM FINISHED');
  await page.getByRole('textbox').first().fill('Still responsive');
  await expect(page.getByRole('textbox').first()).toHaveValue('Still responsive');
  await page.route('**/session/ses_one/message*', (route) => route.fulfill({ json: [message('msg_live', 'recovered while disconnected')] }));
  await page.evaluate(() => {
    (window as unknown as { tetherStream: { streams: ReadableStreamDefaultController<Uint8Array>[] } }).tetherStream.streams.at(-1)!.close();
  });
  await expect(page.locator('header')).toContainText('reconnecting');
  await expect.poll(() => page.evaluate(() => (window as unknown as { tetherStream: { opens: number } }).tetherStream.opens)).toBe(2);
  await expect(page.locator('[data-message-id="msg_live"]')).toContainText('recovered while disconnected');
  await expect(page.locator('[data-message-id="msg_live"]')).toHaveCount(1);
});

test('watchdog aborts silent body and automatically opens a new stream', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!);
  await page.clock.install();
  await page.clock.fastForward(46_000);
  await expect.poll(() => page.evaluate(() => (window as unknown as { tetherStream: { aborted: number } }).tetherStream.aborted)).toBeGreaterThan(0);
  await page.clock.fastForward(2_000);
  await expect.poll(() => page.evaluate(() => (window as unknown as { tetherStream: { opens: number } }).tetherStream.opens)).toBeGreaterThanOrEqual(2);
});

test('large transcripts bound mounted messages and large reasoning stays usable at 320px', async ({ page, baseURL }) => {
  await mockBackend(page);
  await seed(page, baseURL!);
  const transcript = Array.from({ length: 500 }, (_, i) => ({ ...message(`msg_${i}`, `Response ${i}`), info: { ...message(`msg_${i}`).info, time: { created: i + 1, completed: i + 2 } } }));
  transcript.at(-1)!.parts.push({ id: 'reasoning', sessionID: 'ses_one', messageID: 'msg_499', type: 'reasoning', text: 'large reasoning '.repeat(10_000) });
  await page.route('**/session/ses_one/message*', (route) => route.fulfill({ json: transcript }));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.locator('article[data-message-id]')).toHaveCount(60);
  await page.getByRole('button', { name: 'Thought', exact: true }).click();
  await expect(page.locator('[data-message-id="msg_499"]')).toContainText('large reasoning');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scroller = page.getByTestId('transcript');
  await expect.poll(() => scroller.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(4);
  await scroller.evaluate((node) => { node.scrollTop -= 1000; });
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect.poll(() => scroller.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(4);
  await page.getByRole('button', { name: 'Show earlier messages (440)' }).click();
  await expect(page.locator('article[data-message-id]')).toHaveCount(120);
});

test('request timeout also covers a stalled response body', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new OpencodeClient(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    await expect(client.get('/slow', 100)).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('SSE resumes from explicit event IDs and skips replayed IDs', async () => {
  let calls = 0;
  let resume = '';
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    calls++;
    if (calls === 2) resume = String(req.headers['last-event-id'] ?? '');
    res.end('id: one\ndata: {"type":"first","properties":{}}\n\n' + (calls === 2 ? 'id: two\ndata: {"type":"second","properties":{}}\n\n' : ''));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new OpencodeClient(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    const abort = new AbortController();
    const first = [];
    for await (const event of client.stream('/event', abort.signal)) first.push(event.type);
    const second = [];
    for await (const event of client.stream('/event', abort.signal)) second.push(event.type);
    expect(first).toEqual(['first']);
    expect(second).toEqual(['second']);
    expect(resume).toBe('one');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('permission and question replies from another client clear cards by requestID', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!);
  await emit(page, [
    { type: 'permission.asked', properties: { id: 'perm_live', sessionID: 'ses_one', permission: 'bash', patterns: ['printf'], always: [] } },
    { type: 'question.asked', properties: { id: 'question_live', sessionID: 'ses_one', questions: [{ question: 'Choose regression option', options: [{ label: 'Yes' }] }] } }
  ]);
  await expect(page.getByText('Permission required')).toBeVisible();
  await expect(page.getByText('Choose regression option')).toBeVisible();
  await emit(page, [
    { type: 'permission.replied', properties: { sessionID: 'ses_one', requestID: 'perm_live', reply: 'once' } },
    { type: 'question.replied', properties: { sessionID: 'ses_one', requestID: 'question_live', answers: [['Yes']] } }
  ]);
  await expect(page.getByText('Permission required')).toHaveCount(0);
  await expect(page.getByText('Choose regression option')).toHaveCount(0);
});

test('a delayed transcript snapshot preserves newer stream replacements', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!);
  const original = message('msg_assistant', 'snapshot text');
  await emit(page, [{ type: 'message.part.updated', properties: { part: original.parts[0] } }]);
  await expect(page.locator('[data-message-id="msg_assistant"]')).toContainText('snapshot text');
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route('**/session/ses_one/message*', async (route) => {
    started();
    await pending;
    await route.fulfill({ json: [original] });
  });
  await page.locator('header').getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('menuitem', { name: 'Refresh messages', exact: true }).click();
  await requested;
  await emit(page, [{ type: 'message.part.updated', properties: { part: message('msg_assistant', 'newer live text').parts[0] } }]);
  await expect(page.locator('[data-message-id="msg_assistant"]')).toContainText('newer live text');
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/session/ses_one/message');
  release();
  await (await response).finished();
  await expect(page.locator('[data-message-id="msg_assistant"]')).toContainText('newer live text');
});

test('message pagination limits initial data and loads older history in the same directory', async ({ page, baseURL }) => {
  await mockBackend(page);
  await seed(page, baseURL!);
  const all = Array.from({ length: 120 }, (_, i) => ({ ...message(`msg_${i}`, `History ${i}`), info: { ...message(`msg_${i}`).info, time: { created: i + 1, completed: i + 2 } } }));
  const queries: URLSearchParams[] = [];
  await page.route('**/session/ses_one/message*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query);
    const before = query.get('before');
    const end = before ? Number(before.replace('cursor_', '')) : all.length;
    const start = Math.max(0, end - Number(query.get('limit')));
    return route.fulfill({ json: all.slice(start, end), headers: start ? { 'X-Next-Cursor': `cursor_${start}` } : {} });
  });
  await page.goto('/');
  await expect(page.locator('article[data-message-id]')).toHaveCount(60);
  expect(queries[0].get('limit')).toBe('60');
  expect(queries[0].get('directory')).toBe('/home/test');
  await page.getByRole('button', { name: 'Show earlier messages', exact: true }).click();
  await expect(page.locator('article[data-message-id]')).toHaveCount(120);
  expect(queries[1].get('before')).toBe('cursor_60');
  expect(queries[1].get('directory')).toBe('/home/test');
  await expect(page.locator('[data-message-id="msg_0"]')).toHaveCount(1);
  await expect(page.locator('[data-message-id="msg_119"]')).toHaveCount(1);
});

test('permission responses target the requesting session directory', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!);
  let reply: { directory: string | null; body: unknown } | null = null;
  await page.route('**/permission/perm_scoped/reply*', (route) => {
    reply = { directory: new URL(route.request().url()).searchParams.get('directory'), body: route.request().postDataJSON() };
    return route.fulfill({ json: true });
  });
  await emit(page, [{ type: 'permission.asked', properties: { id: 'perm_scoped', sessionID: 'ses_one', permission: 'bash', patterns: ['printf'], always: [] } }]);
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect.poll(() => reply).toEqual({ directory: '/home/test', body: { reply: 'once' } });
});


test('older hosts fall back from global events to the selected directory stream', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!, true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { tetherStream: { paths: string[] } }).tetherStream.paths.at(-1))).toBe('/event?directory=%2Fhome%2Ftest');
  await emit(page, [{ type: 'message.part.updated', properties: { part: message('msg_assistant', 'legacy stream stays live').parts[0] } }]);
  await expect(page.locator('[data-message-id="msg_assistant"]')).toContainText('legacy stream stays live');
});

test('permission refresh during a session switch cannot erase a concurrent request', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route('**/permission*', async (route) => {
    started();
    await pending;
    await route.fulfill({ json: [] });
  });
  await page.getByRole('button', { name: 'Open Add directory picker', exact: true }).click();
  await requested;
  await emit(page, [{ type: 'permission.asked', properties: { id: 'perm_concurrent', sessionID: 'ses_two', permission: 'bash', patterns: ['printf'], always: [] } }]);
  await expect(page.getByText('Permission required')).toBeVisible();
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/permission');
  release();
  await (await response).finished();
  await expect(page.getByText('Permission required')).toBeVisible();
});

test('deep links fetch sessions outside the initial capped session list', async ({ page, baseURL }) => {
  await mockBackend(page);
  await seed(page, baseURL!);
  let lookups = 0;
  await page.route('**/session/ses_linked', (route) => {
    lookups++;
    return route.fulfill({ json: { id: 'ses_linked', projectID: 'global', directory: '/home/test', title: 'Linked older session', version: '1.0.0', time: { created: 1, updated: 1 } } });
  });
  await page.goto('/?session=ses_linked');
  await expect(page.getByRole('heading', { name: 'Linked older session', exact: true })).toBeVisible();
  expect(lookups).toBe(1);
  await expect(page.getByRole('button', { name: 'Open Linked older session', exact: true })).toBeVisible();
});

const pendingQuestion = (sessionID = 'ses_linked') => ({
  id: 'que_pending', sessionID, tool: { messageID: 'msg_question', callID: 'call_question' },
  questions: [
    { header: 'Colour', question: 'Which colour should we use?', options: [{ label: 'Blue', description: 'Sky blue' }], custom: false },
    { header: 'Details', question: 'Add a custom detail?', options: [{ label: 'Default' }] },
    { header: 'Features', question: 'Which features?', multiple: true, options: [{ label: 'Fast' }, { label: 'Small' }] }
  ]
});

test('pending multi-question deep link survives capped refresh/reconnect and replies in its directory', async ({ page, baseURL }) => {
  await mockBackend(page);
  await seed(page, baseURL!);
  await installStream(page);
  await page.addInitScript(() => {
    const key = 'opencode-tether.store.v1';
    const data = JSON.parse(localStorage.getItem(key)!);
    data.settings.autoReconnect = true;
    localStorage.setItem(key, JSON.stringify(data));
  });
  let pending = true;
  let reply: unknown;
  await page.route('**/session/ses_linked', (route) => route.fulfill({ json: { id: 'ses_linked', directory: '/other/project', title: 'Pending older session', time: { created: 1, updated: 1 } } }));
  await page.route(/\/question(?:\/|\?|$)/, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/reply')) {
      reply = { directory: url.searchParams.get('directory'), body: route.request().postDataJSON() };
      pending = false;
      return route.fulfill({ json: true });
    }
    return route.fulfill({ json: pending && url.searchParams.get('directory') === '/other/project' ? [pendingQuestion()] : [] });
  });
  await page.goto('/?session=ses_linked');
  await expect(page.getByRole('region', { name: 'Question awaiting answer' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Which colour should we use?')).toBeVisible();
  await page.evaluate(() => (window as unknown as { tetherStream: { streams: ReadableStreamDefaultController<Uint8Array>[] } }).tetherStream.streams.at(-1)!.close());
  await expect.poll(() => page.evaluate(() => (window as unknown as { tetherStream: { opens: number } }).tetherStream.opens)).toBe(2);
  await expect(page.getByRole('heading', { name: 'Pending older session', exact: true })).toBeVisible();
  await expect(page.getByText('Which colour should we use?')).toBeVisible();
  await page.getByRole('button', { name: 'Blue Sky blue' }).click();
  await page.getByPlaceholder('Type another answer…').first().fill('Custom detail');
  await page.getByRole('button', { name: 'Fast', exact: true }).click();
  await page.getByRole('button', { name: 'Small', exact: true }).click();
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect.poll(() => reply).toEqual({ directory: '/other/project', body: { answers: [['Blue'], ['Custom detail'], ['Fast', 'Small']] } });
  await expect(page.getByRole('region', { name: 'Question awaiting answer' })).toHaveCount(0);
});

test('missed question is fetched after SSE drop and periodic reconciliation', async ({ page, baseURL }) => {
  await page.clock.install();
  await openStreaming(page, baseURL!);
  let pending = false;
  await page.route(/\/question(?:\/|\?|$)/, (route) => route.fulfill({ json: pending ? [pendingQuestion('ses_one')] : [] }));
  pending = true;
  await page.evaluate(() => (window as unknown as { tetherStream: { streams: ReadableStreamDefaultController<Uint8Array>[] } }).tetherStream.streams.at(-1)!.close());
  await expect(page.getByText('Which colour should we use?')).toBeVisible();
  pending = false;
  await page.clock.fastForward(21_000);
  await expect(page.getByRole('region', { name: 'Question awaiting answer' })).toHaveCount(0);
});

test('legacy question events survive concurrent snapshots and rejection uses requestID', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!, true);
  await page.evaluate((request) => {
    const state = (window as unknown as { tetherStream: { streams: ReadableStreamDefaultController<Uint8Array>[] } }).tetherStream;
    state.streams.at(-1)!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'question.asked', properties: request })}\n\n`));
  }, pendingQuestion('ses_one'));
  await expect(page.getByText('Which colour should we use?')).toBeVisible();
  await page.getByRole('button', { name: 'Open Add directory picker', exact: true }).click();
  await expect(page.getByText('Which colour should we use?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Polish the interface', exact: true }).click();
  // The scoped empty snapshot is authoritative and clears the previous request.
  await expect(page.getByText('Which colour should we use?')).toHaveCount(0);
  await emit(page, [{ type: 'question.asked', properties: pendingQuestion('ses_one') }]);
  await expect(page.getByText('Which colour should we use?')).toBeVisible();
  await emit(page, [{ type: 'question.rejected', properties: { requestID: 'que_pending', sessionID: 'ses_one' } }]);
  await expect(page.getByRole('region', { name: 'Question awaiting answer' })).toHaveCount(0);
  await emit(page, [{ type: 'question.asked', properties: pendingQuestion('ses_one') }]);
  await expect(page.getByRole('region', { name: 'Question awaiting answer' })).toHaveCount(0);
});

test('running question tool directs the user to the answer panel instead of empty input', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!);
  await emit(page, [
    { type: 'message.updated', properties: { info: { ...message('msg_question').info } } },
    { type: 'message.part.updated', properties: { part: { id: 'part_question', messageID: 'msg_question', sessionID: 'ses_one', type: 'tool', tool: 'question', callID: 'call_question', state: { status: 'running', input: {}, time: { start: Date.now() } } } } },
    { type: 'question.asked', properties: pendingQuestion('ses_one') }
  ]);
  await expect(page.getByText('Waiting for your answer in the question panel below.')).toBeVisible();
  await page.getByRole('button', { name: 'Go to question', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Question awaiting answer' })).toBeFocused();
});

test('pending requests hydrate omitted sessions and stale snapshots cannot resurrect a replied question', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!);
  await page.route('**/session/ses_linked', (route) => route.fulfill({ json: { id: 'ses_linked', directory: '/home/test', title: 'Question outside capped list', time: { created: 1, updated: 1 } } }));
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route(/\/question(?:\?|$)/, async (route) => {
    started();
    await pending;
    await route.fulfill({ json: [pendingQuestion()] });
  });
  await page.getByRole('button', { name: 'Open Add directory picker', exact: true }).click();
  await requested;
  // This request is asked and resolved entirely while the HTTP snapshot is in flight.
  await emit(page, [{ type: 'question.asked', properties: pendingQuestion() }]);
  await expect(page.getByRole('button', { name: 'Open Question outside capped list', exact: true })).toBeVisible();
  await emit(page, [{ type: 'question.replied', properties: { requestID: 'que_pending', sessionID: 'ses_linked', answers: [['Blue']] } }]);
  release();
  await page.getByRole('button', { name: 'Open Question outside capped list', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Question outside capped list', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Question awaiting answer' })).toHaveCount(0);
});

test('reconnect discovers a background directory question whose session is omitted from the capped list', async ({ page, baseURL }) => {
  await openStreaming(page, baseURL!);
  await page.route('**/session/ses_linked', (route) => route.fulfill({ json: { id: 'ses_linked', directory: '/background', title: 'Background question', time: { created: 1, updated: 1 } } }));
  await emit(page, [{ type: 'session.updated', properties: { info: { id: 'ses_background_known', directory: '/background', title: 'Known background directory', time: { created: 1, updated: 1 } } } }]);
  await page.route(/\/question(?:\?|$)/, (route) => route.fulfill({ json: new URL(route.request().url()).searchParams.get('directory') === '/background' ? [pendingQuestion()] : [] }));
  await page.evaluate(() => (window as unknown as { tetherStream: { streams: ReadableStreamDefaultController<Uint8Array>[] } }).tetherStream.streams.at(-1)!.close());
  await expect(page.getByRole('button', { name: 'Open Background question', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Question awaiting answer' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Background question', exact: true }).click();
  await expect(page.getByText('Which colour should we use?')).toBeVisible();
  await page.getByRole('button', { name: 'Open Polish the interface', exact: true }).click();
  await expect(page.getByText('Which colour should we use?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Background question', exact: true }).click();
  await expect(page.getByText('Which colour should we use?')).toBeVisible();
});
