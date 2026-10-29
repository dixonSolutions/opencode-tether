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

<label class="flex cursor-pointer items-start justify-between gap-3 py-2">
  <span class="min-w-0">
    <span class="block text-[11.5px] font-medium leading-5">{label}</span>
    {#if description}<span class="block text-[9.5px] leading-relaxed text-muted-foreground/60">{description}</span>{/if}
  </span>
  <Switch bind:checked {disabled} onCheckedChange={onChange} class="mt-1 shrink-0" size="sm" />
</label>
