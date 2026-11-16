<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils';
  import { onDestroy, tick } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import TerminalIcon from '@lucide/svelte/icons/terminal';
  import X from '@lucide/svelte/icons/x';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Eraser from '@lucide/svelte/icons/eraser';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let host: HTMLDivElement;
  let term = $state.raw<Terminal | null>(null);
  let fit: FitAddon | null = null;
  let socket: WebSocket | null = null;
  let ptyID = $state<string | null>(null);
  let ptyDirectory: string | null = null;
  let ptyClient: typeof app.client = null;
  let observer: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let lifecycle = 0;
  let outputCursor: number | null = null;
  let reconnectAttempts = $state(0);
  let hasConnected = false;
  let destroyed = false;
  let starting = $state(false);
  let reconnecting = $state(false);
  let terminalGone = $state(false);
  let error = $state<string | null>(null);
  let startedFor = $state<string | null>(null);
  let ready = $state(false);
  let wasOpen = false;

  onDestroy(() => {
    destroyed = true;
    cleanup();
  });

  const session = $derived(app.selectedSession);
  const title = $derived(session?.title || session?.slug || 'session');

  function isDark(): boolean {
    return settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function termTheme() {
    return isDark()
      ? {
          background: '#0b0a0a',
          foreground: '#f3efec',
          cursor: '#fab283',
          cursorAccent: '#0b0a0a',
          selectionBackground: '#3a2b23',
          black: '#1b1717',
          red: '#f28b82',
          green: '#a8d8a0',
          yellow: '#e6c07b',
          blue: '#8cc8ff',
          magenta: '#d7b0ff',
          cyan: '#8fe3e0',
          white: '#f3efec',
          brightBlack: '#7f7a76',
          brightRed: '#ff9e97',
          brightGreen: '#c2f0b8',
          brightYellow: '#f4d79c',
          brightBlue: '#adddff',
          brightMagenta: '#e8c9ff',
          brightCyan: '#b3f4f1',
          brightWhite: '#ffffff'
        }
      : {
          background: '#faf8f6',
          foreground: '#231e1b',
          cursor: '#b9692f',
          cursorAccent: '#faf8f6',
          selectionBackground: '#f0d6c4',
          black: '#231e1b',
          red: '#b3261e',
          green: '#2d6a2d',
          yellow: '#8a5a00',
          blue: '#1d5fa8',
          magenta: '#7b3fa0',
          cyan: '#0d6b6b',
          white: '#faf8f6',
          brightBlack: '#7b726d',
          brightRed: '#d94b40',
          brightGreen: '#3e8a3e',
          brightYellow: '#a87512',
          brightBlue: '#3579c4',
          brightMagenta: '#9859bf',
          brightCyan: '#1a8a8a',
          brightWhite: '#ffffff'
        };
  }

  $effect(() => {
    if (term) term.options.theme = termTheme();
  });

  $effect(() => {
    if (open && term && (startedFor !== app.selectedSessionId || ptyClient !== app.client)) {
      void restart();
    }
  });

  $effect(() => {
    if (!open) {
      if (wasOpen) cleanup();
      wasOpen = false;
      return;
    }
    const opening = !wasOpen;
    wasOpen = true;
    if (opening && !term) error = null;
    if (!term && !starting && !error) {
      void start();
    } else {
      requestAnimationFrame(() => fit?.fit());
    }
  });

  async function start() {
    if (!app.client || starting || destroyed) return;
    const attempt = ++lifecycle;
    const client = app.client;
    const directory = session?.directory ?? null;
    ptyClient = client;
    ptyDirectory = directory;
    starting = true;
    error = null;
    reconnecting = false;
    terminalGone = false;
    reconnectAttempts = 0;
    outputCursor = null;
    hasConnected = false;
    await tick();
    if (!host) {
      starting = false;
      return;
    }
    try {
      const terminal = new Terminal({
        fontFamily: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
        fontSize: 12.5,
        lineHeight: 1.25,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        convertEol: false,
        disableStdin: true,
        theme: termTheme(),
        allowProposedApi: true
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(host);
      fitAddon.fit();
      terminal.focus();
      term = terminal;
      fit = fitAddon;
      startedFor = app.selectedSessionId;
      ready = false;
      terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(data);
      });
      terminal.onResize(({ cols, rows }) => scheduleResize(cols, rows));
      observer = new ResizeObserver(() => {
        fitAddon.fit();
      });
      observer.observe(host);

      const pty = await client.post<{ id: string }>(
        ptyPath('/pty', directory),
        {
          command: '/bin/sh',
          args: [],
          cwd: session?.directory,
          title: `tether · ${title}`,
          env: { TERM: 'xterm-256color' }
        },
        20_000
      );
      if (attempt !== lifecycle || !open) {
        void client.delete(ptyPath(`/pty/${pty.id}`, directory)).catch(() => undefined);
        return;
      }
      ptyID = pty.id;
      // The server cursor indexes its retained JavaScript string buffer. Zero is
      // equivalent to replaying the full retained buffer, but also lets us resume
      // safely if the first socket drops before its cursor metadata arrives.
      outputCursor = 0;
      await connectPty(attempt, client, pty.id, directory, terminal, fitAddon);
    } catch (err) {
      if (attempt === lifecycle) {
        error = err instanceof Error ? err.message : String(err);
        term?.writeln(`\r\n\x1b[31m${error}\x1b[0m`);
        observer?.disconnect();
        observer = null;
        socket?.close();
        socket = null;
        if (ptyID) void client.delete(ptyPath(`/pty/${ptyID}`, directory)).catch(() => undefined);
        ptyID = null;
        term?.dispose();
        term = null;
        fit = null;
        ready = false;
      }
    } finally {
      if (attempt === lifecycle) starting = false;
    }
  }

  async function connectPty(attempt: number, client: NonNullable<typeof app.client>, id: string, directory: string | null, terminal: Terminal, fitAddon: FitAddon) {
    if (attempt !== lifecycle || !open || destroyed) return;
    let ticket = '';
    try {
      const response = await client.raw(ptyPath(`/pty/${id}/connect-token`, directory), {
        method: 'POST',
        headers: { 'x-opencode-ticket': '1' }
      });
      if (response.ok) {
        const data = (await response.json()) as { ticket?: string; data?: { ticket?: string } };
        ticket = data.ticket ?? data.data?.ticket ?? '';
      } else if (response.status === 404) {
        const check = await client.raw(ptyPath(`/pty/${id}`, directory));
        if (check.status === 404) {
          markPtyGone(attempt);
          return;
        }
        if (check.status === 401 || check.status === 403) {
          markAuthError(attempt);
          return;
        }
        if (!check.ok) throw new Error(`Could not reconnect to terminal (HTTP ${response.status}).`);
        try {
          const payload = (await check.json()) as { status?: unknown; data?: { status?: unknown } };
          const info = payload.data ?? payload;
          if (info.status === 'exited') {
            markPtyGone(attempt, 'This terminal process has exited. The host may have restarted; start a new shell to continue.');
            return;
          }
        } catch {
          // Some older versions omit PTY details; a successful lookup still permits token fallback.
        }
        // Older opencode versions may not implement connect tokens.
      } else if (response.status === 401 || response.status === 403) {
        markAuthError(attempt);
        return;
      } else {
        throw new Error(`Could not reconnect to terminal (HTTP ${response.status}).`);
      }
    } catch (err) {
      if (attempt === lifecycle) scheduleReconnect(attempt, client, id, directory, terminal, fitAddon, err);
      return;
    }
    if (attempt !== lifecycle || !open || destroyed) return;

    const base = client.baseUrl.replace(/^http/i, 'ws');
    const params = new URLSearchParams();
    if (directory) params.set('directory', directory);
    if (ticket) params.set('ticket', ticket);
    if (client.auth.username || client.auth.password) {
      params.set('auth_token', base64Utf8(`${client.auth.username ?? ''}:${client.auth.password ?? ''}`));
    }
    if (hasConnected && outputCursor !== null) params.set('cursor', String(outputCursor));
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${base}/pty/${id}/connect?${params.toString()}`);
    } catch (err) {
      scheduleReconnect(attempt, client, id, directory, terminal, fitAddon, err);
      return;
    }
    ws.binaryType = 'arraybuffer';
    socket = ws;
    ws.onopen = () => {
      if (attempt !== lifecycle || socket !== ws) return;
      reconnecting = false;
      ready = true;
      terminal.options.disableStdin = false;
      error = null;
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = setTimeout(() => {
        stableTimer = null;
        reconnectAttempts = 0;
      }, 30_000);
      if (!hasConnected) {
        terminal.writeln(`\x1b[2mopencode-tether · ${title}\x1b[0m`);
        hasConnected = true;
      }
      fitAddon.fit();
      scheduleResize(terminal.cols, terminal.rows);
    };
    ws.onmessage = (event) => {
      if (attempt !== lifecycle || socket !== ws) return;
      const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
      if (data.startsWith('\0')) {
        try {
          const metadata = JSON.parse(data.slice(1)) as { cursor?: unknown };
          if (typeof metadata.cursor === 'number' && Number.isSafeInteger(metadata.cursor) && metadata.cursor >= 0) {
            outputCursor = metadata.cursor;
          }
        } catch {
          // Ignore malformed control frames and preserve the terminal stream.
        }
        return;
      }
      terminal.write(data);
      if (outputCursor !== null) outputCursor += data.length;
    };
    ws.onerror = () => handleDisconnect(ws, attempt, client, id, directory, terminal, fitAddon);
    ws.onclose = () => handleDisconnect(ws, attempt, client, id, directory, terminal, fitAddon);
  }

  function handleDisconnect(ws: WebSocket, attempt: number, client: NonNullable<typeof app.client>, id: string, directory: string | null, terminal: Terminal, fitAddon: FitAddon) {
    if (attempt !== lifecycle || socket !== ws) return;
    socket = null;
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = null;
    try {
      ws.close();
    } catch {
      // The browser may already have closed the socket.
    }
    ready = false;
    terminal.options.disableStdin = true;
    scheduleReconnect(attempt, client, id, directory, terminal, fitAddon);
  }

  function scheduleReconnect(
    attempt: number,
    client: NonNullable<typeof app.client>,
    id: string,
    directory: string | null,
    terminal: Terminal,
    fitAddon: FitAddon,
    cause?: unknown
  ) {
    if (attempt !== lifecycle || !open || destroyed || reconnectTimer || terminalGone) return;
    if (reconnectAttempts >= 6) {
      reconnecting = false;
      error = cause instanceof Error
        ? `Could not reconnect to the existing terminal: ${cause.message}`
        : 'Could not reconnect to the existing terminal. Retry the connection or restart the shell.';
      return;
    }
    reconnectAttempts += 1;
    const delay = Math.min(500 * 2 ** (reconnectAttempts - 1), 8_000);
    reconnecting = true;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectPty(attempt, client, id, directory, terminal, fitAddon);
    }, delay);
  }

  function markPtyGone(attempt: number, message = 'This terminal session is no longer available. The host may have restarted; start a new shell to continue.') {
    if (attempt !== lifecycle) return;
    terminalGone = true;
    reconnecting = false;
    ready = false;
    error = message;
  }

  function markAuthError(attempt: number) {
    if (attempt !== lifecycle) return;
    reconnecting = false;
    ready = false;
    error = 'Terminal authentication was rejected. Check the host credentials and retry the connection.';
  }

  function base64Utf8(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function ptyPath(path: string, directory: string | null): string {
    return directory ? `${path}?directory=${encodeURIComponent(directory)}` : path;
  }

  function retryConnection() {
    if (!ptyID || !ptyClient || !term || !fit || terminalGone) {
      void restart();
      return;
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = null;
    reconnectAttempts = 0;
    error = null;
    reconnecting = true;
    void connectPty(lifecycle, ptyClient, ptyID, ptyDirectory, term, fit);
  }

  function recoverConnection() {
    if (!open || starting || terminalGone || !ptyID || !ptyClient || !term || !fit) return;
    const previous = socket;
    socket = null;
    previous?.close();
    ready = false;
    term.options.disableStdin = true;
    retryConnection();
  }

  function scheduleResize(cols: number, rows: number) {
    if (!ptyID || !ptyClient) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    const id = ptyID;
    const client = ptyClient;
    const directory = ptyDirectory;
    resizeTimer = setTimeout(() => {
      void client.put(ptyPath(`/pty/${id}`, directory), { size: { cols, rows } }).catch(() => undefined);
    }, 120);
  }

  function cleanup() {
    lifecycle += 1;
    starting = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = null;
    reconnectAttempts = 0;
    reconnecting = false;
    terminalGone = false;
    outputCursor = null;
    hasConnected = false;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = null;
    observer?.disconnect();
    observer = null;
    socket?.close();
    socket = null;
    term?.dispose();
    term = null;
    ready = false;
    fit = null;
    startedFor = null;
    if (ptyID && ptyClient) {
      void ptyClient.delete(ptyPath(`/pty/${ptyID}`, ptyDirectory)).catch(() => undefined);
    }
    ptyID = null;
    ptyClient = null;
    ptyDirectory = null;
  }

  async function restart() {
    cleanup();
    await tick();
    if (open && !destroyed) void start();
  }

  function close() {
    open = false;
  }

  function clear() {
    term?.clear();
  }
</script>

<svelte:window ononline={recoverConnection} onpageshow={recoverConnection} />
<svelte:document onvisibilitychange={() => { if (document.visibilityState === 'visible') recoverConnection(); }} />

<Sheet.Root bind:open>
  <Sheet.Content side="bottom" showCloseButton={false} class="safe-x android-safe-bottom h-[78dvh] gap-0 border-t border-border/70 bg-[#0b0a0a] p-0 sm:h-[66dvh]">
    <Sheet.Title class="sr-only">Terminal</Sheet.Title>
    <Sheet.Description class="sr-only">Shell attached to the current session.</Sheet.Description>
    <div class="android-safe-top flex min-h-14 shrink-0 items-center gap-1.5 border-b border-white/10 px-2.5 sm:gap-2.5 sm:px-3.5">
      <span class="grid size-9 place-items-center rounded-lg bg-tether/10 text-tether"><TerminalIcon class="size-5" /></span>
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">Terminal <span class="font-normal text-muted-foreground/60">· {title}</span></span>
      {#if starting}
        <span class="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 class="size-4 animate-spin" /> opening</span>
      {:else if reconnecting}
        <span class="flex min-w-0 shrink-0 items-center gap-1 text-[10px] text-muted-foreground sm:gap-1.5 sm:text-xs" role="status">
          <Loader2 class="size-4 shrink-0 animate-spin" />
          <span class="sm:hidden">retry {reconnectAttempts}/6</span>
          <span class="hidden sm:inline">reconnecting {reconnectAttempts}/6</span>
        </span>
      {:else if ready}
        <span class="live-dot size-2 rounded-full bg-emerald-400"></span>
      {/if}
      <button type="button" class="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground" onclick={restart} title="Restart shell" aria-label="Restart shell">
        <RotateCcw class="size-4" />
      </button>
      <button type="button" class="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground" onclick={clear} title="Clear terminal" aria-label="Clear terminal">
        <Eraser class="size-4" />
      </button>
      <button type="button" class="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground" onclick={close} title="Close terminal" aria-label="Close terminal">
        <X class="size-4" />
      </button>
    </div>
    {#if error}
      <div class="flex items-center gap-2 border-b border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs text-red-300">
        <CircleAlert class="size-4" /> <span class="min-w-0 flex-1 truncate">{error}</span>
        <button class="rounded px-1 py-0.5 underline underline-offset-2 hover:bg-red-500/10" onclick={terminalGone ? restart : retryConnection}>{terminalGone ? 'start new shell' : ptyID ? 'retry connection' : 'retry'}</button>
      </div>
    {/if}
    <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <div bind:this={host} class={cn('terminal-surface h-full w-full overflow-hidden px-1 py-1', starting && 'opacity-50')}></div>
      {#if starting && !term}
        <div class="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground/60">opening shell…</div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
