<script lang="ts">
  let {
    size = 32,
    wordmark = false,
    tagline = false,
    class: className = ''
  }: { size?: number; wordmark?: boolean; tagline?: boolean; class?: string } = $props();
</script>

<div class="flex items-center gap-2.5 {className}">
  <svg
    width={size}
    height={size}
    viewBox="0 0 1024 1024"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="opencode-tether"
    class="shrink-0 drop-shadow-[0_2px_8px_rgba(250,178,131,0.08)]"
  >
    <rect width="1024" height="1024" rx="224" fill="#171313" />
    <rect x="1" y="1" width="1022" height="1022" rx="223" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2" />
    <g transform="translate(512 476) scale(1.16) translate(-256 -256)">
      <path d="M320 224V352H192V224H320Z" fill="#5A5858" />
      <path fill-rule="evenodd" clip-rule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="white" />
    </g>
    <g transform="translate(512 512)">
      <path d="M146 274c0-34 27-61 61-61h45" stroke="#fab283" stroke-width="30" stroke-linecap="round" />
      <path d="M274 146c34 0 61 27 61 61v45" stroke="#fab283" stroke-width="30" stroke-linecap="round" />
      <circle cx="146" cy="274" r="27" fill="#0b0a0a" stroke="#fab283" stroke-width="16" />
      <circle cx="335" cy="252" r="27" fill="#0b0a0a" stroke="#fab283" stroke-width="16" />
    </g>
  </svg>
  {#if wordmark}
    <div class="min-w-0 leading-none">
      <div class="flex items-baseline gap-0.5 text-[15px] font-semibold tracking-tight">
        <span>opencode</span><span class="text-tether">tether</span>
      </div>
      {#if tagline}
        <div class="mt-1 text-[9.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">unofficial remote</div>
      {/if}
    </div>
  {/if}
</div>
