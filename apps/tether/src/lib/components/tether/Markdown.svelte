<script lang="ts">
  import { Marked } from 'marked';
  import DOMPurify from 'dompurify';
  import hljs from 'highlight.js/lib/common';
  import { copyText, openExternal } from '$lib/platform';

  let { text = '', class: className = '' }: { text?: string; class?: string } = $props();

  const marked = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      code({ text, lang }) {
        const language = (lang ?? '').split(/\s+/)[0];
        let highlighted = '';
        try {
          highlighted = language && hljs.getLanguage(language) ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value;
        } catch {
          highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        return `<pre data-lang="${language}"><code class="hljs">${highlighted}</code></pre>`;
      }
    }
  });

  let container: HTMLDivElement;
  let html = $state('');

  $effect(() => {
    const source = text ?? '';
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
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    border-radius: 5px;
    padding: 3px 7px;
    opacity: 0;
    transition: opacity 120ms ease;
    cursor: pointer;
  }
  :global(.md pre:hover .md-copy),
  :global(.md pre .md-copy:focus-visible) {
    opacity: 1;
  }
  :global(.md pre .md-copy:hover) {
    color: var(--foreground);
    background: var(--muted);
  }
</style>
