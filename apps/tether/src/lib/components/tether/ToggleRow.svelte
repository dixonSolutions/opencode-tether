<script lang="ts">
  import { Root as Switch } from '$lib/components/ui/switch/index.js';

  let {
    label,
    description = '',
    checked = $bindable(false),
    disabled = false,
    onChange
  }: { label: string; description?: string; checked?: boolean; disabled?: boolean; onChange?: (checked: boolean) => void } = $props();
</script>

<label class="flex min-h-14 cursor-pointer items-start justify-between gap-3 py-3">
  <span class="min-w-0">
    <span class="block text-sm font-medium leading-6">{label}</span>
    {#if description}<span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground/60">{description}</span>{/if}
  </span>
  <Switch bind:checked {disabled} onCheckedChange={onChange} class="mt-1 shrink-0" />
</label>
