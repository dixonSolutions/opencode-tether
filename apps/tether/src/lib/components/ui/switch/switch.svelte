<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null), checked = $bindable(false), disabled = false,
    size = 'default', class: className, onCheckedChange, ...restProps
  }: Omit<HTMLButtonAttributes, 'onclick'> & {
    ref?: HTMLButtonElement | null;
    checked?: boolean;
    size?: 'sm' | 'default';
    onCheckedChange?: (checked: boolean) => void;
  } = $props();
</script>

<!-- Native button supplies Space/Enter, focus and disabled semantics without per-row observers. -->
<button
  {...restProps}
  bind:this={ref}
  type="button"
  role="switch"
  aria-checked={checked}
  {disabled}
  data-slot="switch"
  data-state={checked ? 'checked' : 'unchecked'}
  data-size={size}
  class={cn(
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'h-6 w-10' : 'h-7 w-12',
    checked ? 'bg-primary' : 'bg-muted-foreground/35 dark:bg-muted-foreground/30', className
  )}
  onclick={() => { checked = !checked; onCheckedChange?.(checked); }}
>
  <span data-slot="switch-thumb" aria-hidden="true" class={cn(
    'pointer-events-none block rounded-full bg-white shadow-sm ring-0 transition-transform',
    size === 'sm' ? 'size-5' : 'size-6',
    checked ? (size === 'sm' ? 'translate-x-[18px]' : 'translate-x-[22px]') : 'translate-x-0.5'
  )}></span>
</button>
