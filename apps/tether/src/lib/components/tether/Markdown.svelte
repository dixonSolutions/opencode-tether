<script lang="ts">
  import { Marked } from 'marked';
  import DOMPurify from 'dompurify';
  import hljs from 'highlight.js/lib/common';
  import { copyText, openExternal } from '$lib/platform';

  let { text = '', class: className = '', streaming = false }: { text?: string; class?: string; streaming?: boolean } = $props();

  const marked = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      code({ text, lang }) {
        const language = (lang ?? '').split(/\s+/)[0];
        let highlighted = '';
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (!streaming) {
          try {
            highlighted = language && hljs.getLanguage(language) ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value;
          } catch {
            highlighted = escaped;
          }
        } else {
          highlighted = escaped;
        }
        return `<pre data-lang="${language}"><code class="hljs">${highlighted}</code></pre>`;
      }
    }
  });

  let container: HTMLDivElement;
  let html = $state('');
  let lastRender = 0;
  let pending: string | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  function render(source: string) {
    let rendered = '';
    try {
      rendered = marked.parse(source, { async: false }) as string;
    } catch {
      rendered = source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    html = DOMPurify.sanitize(rendered, {
      ADD_ATTR: ['target', 'rel', 'data-lang'],
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed']
    });
  }

  $effect(() => {
    const source = text ?? '';
    if (!streaming) {
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = null;
      pending = null;
      render(source);
      lastRender = performance.now();
      return;
    }
    const now = performance.now();
    if (now - lastRender >= 70) {
      render(source);
      lastRender = now;
      return;
    }
    pending = source;
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      const next = pending;
      pending = null;
      if (next !== null) {
        render(next);
        lastRender = performance.now();
      }
    }, 70);
  });

  $effect(() => {
    return () => {
      if (renderTimer) clearTimeout(renderTimer);
    };
  });

  $effect(() => {
    if (!container || !html) return;
    const blocks = container.querySelectorAll('pre');
    blocks.forEach((pre) => {
      if (pre.querySelector('.md-copy')) return;
      const button = document.createElement('button');
      button.className = 'md-copy';
      button.type = 'button';
      button.textContent = 'Copy';
      button.addEventListener('click', () => {
        const code = pre.querySelector('code')?.textContent ?? '';
        void copyText(code).then((ok) => {
          button.textContent = ok ? 'Copied' : 'Failed';
          setTimeout(() => (button.textContent = 'Copy'), 1400);
        });
      });
      pre.appendChild(button);
    });
  });

  function linkAction(node: HTMLElement) {
    node.addEventListener('click', onClick);
    return { destroy: () => node.removeEventListener('click', onClick) };
  }

  function onClick(event: MouseEvent) {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      void openExternal(href);
    }
  }
</script>

<div bind:this={container} class="md {className}" use:linkAction role="document">
  {@html html}
</div>

<style>
  :global(.md pre) {
    position: relative;
  }
  :global(.md pre .md-copy) {
    position: absolute;
    top: 0.45rem;
    right: 0.45rem;
    border: 1px solid var(--border);
    background: color-mix(in oklch, var(--background) 82%, transparent);
    color: var(--muted-foreground);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    border-radius: 7px;
    padding: 8px 11px;
    opacity: 0;
    transition: opacity 120ms ease;
    cursor: pointer;
  }
  :global(.md pre:hover .md-copy),
  :global(.md pre .md-copy:focus-visible) {
    opacity: 1;
  }
  @media (hover: none) {
    :global(.md pre .md-copy) {
      opacity: 1;
    }
  }
  :global(.md pre .md-copy:hover) {
    color: var(--foreground);
    background: var(--muted);
  }
</style>
