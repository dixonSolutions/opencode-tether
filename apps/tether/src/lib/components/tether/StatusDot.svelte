<script lang="ts">
  import type { HealthState } from '$lib/api/types';

  let {
    state = 'unknown',
    size = 8,
    pulse = true,
    class: className = ''
  }: { state?: HealthState | 'busy'; size?: number; pulse?: boolean; class?: string } = $props();

  const colors: Record<string, string> = {
    online: 'bg-emerald-400',
    idle: 'bg-emerald-400',
    busy: 'bg-amber-400',
    checking: 'bg-sky-400',
    unknown: 'bg-muted-foreground/40',
    offline: 'bg-red-400',
    unauthorized: 'bg-amber-400'
  };
  const glow: Record<string, string> = {
    online: 'shadow-[0_0_8px_rgba(52,211,153,0.65)]',
    idle: 'shadow-[0_0_8px_rgba(52,211,153,0.45)]',
    busy: 'shadow-[0_0_10px_rgba(251,191,36,0.7)]',
    checking: 'shadow-[0_0_8px_rgba(56,189,248,0.6)]',
    unknown: '',
    offline: 'shadow-[0_0_8px_rgba(248,113,113,0.55)]',
    unauthorized: 'shadow-[0_0_8px_rgba(251,191,36,0.55)]'
  };
  const shouldPulse = $derived(pulse && (state === 'online' || state === 'busy' || state === 'checking'));
</script>

<span
  class="inline-block shrink-0 rounded-full {colors[state] ?? colors.unknown} {glow[state] ?? ''} {shouldPulse ? 'live-dot' : ''} {className}"
  style="width:{size}px;height:{size}px"
  aria-hidden="true"
></span>
