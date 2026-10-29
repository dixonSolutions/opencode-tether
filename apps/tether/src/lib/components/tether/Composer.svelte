<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import ModelPicker from './ModelPicker.svelte';
  import AgentPicker from './AgentPicker.svelte';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils';
  import { toast } from 'svelte-sonner';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Square from '@lucide/svelte/icons/square';
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import X from '@lucide/svelte/icons/x';
  import Bot from '@lucide/svelte/icons/bot';
  import Cpu from '@lucide/svelte/icons/cpu';
  import FileText from '@lucide/svelte/icons/file-text';
  import ImageIcon from '@lucide/svelte/icons/image';
  import CommandIcon from '@lucide/svelte/icons/command';

  interface Attachment {
    mime: string;
    filename: string;
    url: string;
    size: number;
  }

  let text = $state('');
  let attachments = $state<Attachment[]>([]);
  let textarea: HTMLTextAreaElement;
  let fileInput: HTMLInputElement;
  let modelOpen = $state(false);
  let agentOpen = $state(false);
  let composing = $state(false);
  let dragging = $state(false);
  let commandIndex = $state(0);
  let lastSession = $state<string | null>(null);

  const maxAttachment = 12 * 1024 * 1024;

  const slashQuery = $derived.by(() => {
    if (!text.startsWith('/') || text.includes('\n')) return null;
    const raw = text.slice(1);
    if (raw.includes(' ')) return null;
    return raw.toLowerCase();
  });

  const slashMatches = $derived.by(() => {
    if (slashQuery === null) return [];
    return app.commands
      .filter((command) => !slashQuery || command.name.toLowerCase().includes(slashQuery) || command.description?.toLowerCase().includes(slashQuery))
      .slice(0, 8);
  });

  const modelLabel = $derived(app.selectedModel ? app.selectedModel.modelID.split('/').pop() ?? app.selectedModel.modelID : 'default');
  const agentLabel = $derived(app.selectedAgent || 'build');

  $effect(() => {
    const sessionID = app.selectedSessionId;
    if (sessionID !== lastSession) {
      lastSession = sessionID;
      text = app.getDraft(sessionID);
      attachments = [];
      resize();
    }
  });

  $effect(() => {
    commandIndex = 0;
  });

  function resize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const max = Math.min(window.innerHeight * 0.34, 240);
    textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
  }

  function onInput() {
    app.setDraft(app.selectedSessionId, text);
    resize();
  }

  function insertCommand(name: string) {
    text = `/${name} `;
    app.setDraft(app.selectedSessionId, text);
    textarea?.focus();
    resize();
  }

  function onKeydown(event: KeyboardEvent) {
    if (composing || event.isComposing) return;
    if (slashMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        commandIndex = (commandIndex + 1) % slashMatches.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        commandIndex = (commandIndex - 1 + slashMatches.length) % slashMatches.length;
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        insertCommand(slashMatches[commandIndex].name);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        text = '';
        onInput();
        return;
      }
    }
    const wantsSend =
      event.key === 'Enter' &&
      !event.shiftKey &&
      (settings.sendKey === 'enter' ? !event.metaKey && !event.ctrlKey : event.metaKey || event.ctrlKey);
    if (wantsSend) {
      event.preventDefault();
      void send();
    }
  }

  async function send() {
    if (app.isBusy && !text.trim() && attachments.length === 0) return;
    const payload = {
      text,
      attachments: attachments.map(({ mime, filename, url }) => ({ mime, filename, url }))
    };
    const ok = await app.sendPrompt(payload);
    if (ok) {
      text = '';
      attachments = [];
      app.setDraft(app.selectedSessionId, '');
      resize();
      textarea?.focus();
    }
  }

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (file.size > maxAttachment) {
        toast.error('Attachment too large', { description: `${file.name} is over 12 MB.` });
        continue;
      }
      try {
        const url = await readFile(file);
        attachments = [...attachments, { mime: file.type || 'application/octet-stream', filename: file.name, url, size: file.size }];
      } catch {
        toast.error('Could not read attachment', { description: file.name });
      }
    }
  }

  function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function onPaste(event: ClipboardEvent) {
    const files = event.clipboardData?.files;
    if (files?.length) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (event.dataTransfer?.files?.length) void addFiles(event.dataTransfer.files);
  }

  function removeAttachment(index: number) {
    attachments = attachments.filter((_, i) => i !== index);
  }

  function formatSize(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<div
  role="region"
  aria-label="Message composer"
  class="android-safe-bottom android-no-blur relative border-t border-border/60 bg-background/92 px-2.5 pt-2 backdrop-blur-xl sm:px-4 sm:pb-3"
  ondragover={(event) => {
    event.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  {#if slashMatches.length}
    <div class="absolute bottom-[calc(100%-0.25rem)] left-2.5 right-2.5 z-20 overflow-hidden rounded-xl border border-border/80 bg-popover/98 p-1 shadow-2xl backdrop-blur-xl sm:left-4 sm:right-4">
      <div class="flex items-center gap-1.5 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        <CommandIcon class="size-3" /> Commands
      </div>
      {#each slashMatches as command, i}
        <button
          type="button"
          class={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left', i === commandIndex ? 'bg-muted' : 'hover:bg-muted/60')}
          onmouseenter={() => (commandIndex = i)}
          onclick={() => insertCommand(command.name)}
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[12px] font-medium">/{command.name}</span>
            {#if command.description}<span class="block truncate text-[10px] text-muted-foreground">{command.description}</span>{/if}
          </span>
          <span class="text-[9px] uppercase tracking-wide text-muted-foreground/50">{command.source}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if dragging}
    <div class="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-xl border-2 border-dashed border-tether/50 bg-background/85 text-xs font-medium text-tether">
      Drop files to attach
    </div>
  {/if}

  <div class="mx-auto w-full max-w-3xl">
    {#if attachments.length}
      <div class="mb-2 flex flex-wrap gap-1.5">
        {#each attachments as attachment, index}
          <div class="group flex max-w-[220px] items-center gap-1.5 rounded-lg border border-border/70 bg-card/70 py-1 pl-1.5 pr-1">
            {#if attachment.mime.startsWith('image/')}
              <img src={attachment.url} alt="" class="size-7 rounded object-cover" />
            {:else}
              <span class="grid size-7 place-items-center rounded bg-muted text-muted-foreground"><FileText class="size-3.5" /></span>
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[10.5px] font-medium">{attachment.filename}</span>
              <span class="block text-[9px] text-muted-foreground">{formatSize(attachment.size)}</span>
            </span>
            <button type="button" class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onclick={() => removeAttachment(index)} aria-label="Remove attachment">
              <X class="size-3" />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex items-end gap-1.5 rounded-2xl border border-border/80 bg-card/65 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-colors focus-within:border-tether/35 focus-within:bg-card/80">
      <button
        type="button"
        class="mb-0.5 grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        onclick={() => fileInput?.click()}
        aria-label="Attach files"
        title="Attach files"
      >
        <Paperclip class="size-4" />
      </button>
      <input
        bind:this={fileInput}
        type="file"
        multiple
        class="hidden"
        accept="image/*,application/pdf,text/*,.md,.json,.yaml,.yml,.toml,.rs,.ts,.js,.py,.go,.c,.cpp,.h,.css,.html"
        onchange={(event) => {
          const input = event.currentTarget as HTMLInputElement;
          if (input.files) void addFiles(input.files);
          input.value = '';
        }}
      />

      <textarea
        bind:this={textarea}
        bind:value={text}
        oninput={onInput}
        onkeydown={onKeydown}
        onpaste={onPaste}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => {
          composing = false;
          onInput();
        }}
        rows="1"
        enterkeyhint={settings.sendKey === 'enter' ? 'send' : 'enter'}
        placeholder={app.selectedSession ? 'Message opencode…' : 'Start a new session…'}
        class="tether-scroll max-h-[34dvh] min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
        aria-label="Message"
      ></textarea>

      <div class="mb-0.5 flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="hidden h-8 items-center gap-1.5 rounded-xl px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground sm:flex"
          onclick={() => (agentOpen = true)}
          title="Agent"
        >
          <Bot class="size-3.5" />
          <span class="max-w-20 truncate">{agentLabel}</span>
        </button>
        <button
          type="button"
          class="hidden h-8 items-center gap-1.5 rounded-xl px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground sm:flex"
          onclick={() => (modelOpen = true)}
          title="Model"
        >
          <Cpu class="size-3.5" />
          <span class="max-w-24 truncate">{modelLabel}</span>
        </button>
        {#if app.isBusy}
          <Button size="icon-sm" variant="secondary" class="size-9 rounded-xl" onclick={() => app.abort()} aria-label="Stop generating" title="Stop">
            <Square class="size-3.5 fill-current" />
          </Button>
        {:else}
          <Button
            size="icon-sm"
            class="size-9 rounded-xl bg-tether text-primary-foreground hover:bg-tether/85"
            onclick={send}
            disabled={!text.trim() && attachments.length === 0}
            aria-label="Send message"
            title="Send"
          >
            <ArrowUp class="size-4" />
          </Button>
        {/if}
      </div>
    </div>

    <div class="mt-1 flex items-center justify-between px-1 text-[9px] text-muted-foreground/40">
      <span class="hidden sm:inline">
        {settings.sendKey === 'enter' ? 'Enter to send · Shift+Enter for newline' : '⌘/Ctrl+Enter to send'}
        <span class="mx-1">·</span> / commands <span class="mx-1">·</span> ! shell
      </span>
      <span class="sm:hidden">
        <button type="button" class="rounded px-1 py-0.5 active:bg-muted" onclick={() => (modelOpen = true)}>{modelLabel}</button>
        <span class="mx-0.5">·</span>
        <button type="button" class="rounded px-1 py-0.5 active:bg-muted" onclick={() => (agentOpen = true)}>{agentLabel}</button>
      </span>
      <span>{text.trim() ? `${text.trim().length} chars` : ''}</span>
    </div>
  </div>
</div>

<ModelPicker bind:open={modelOpen} />
<AgentPicker bind:open={agentOpen} />
