<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from '$lib/components/ui/sonner/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<ModeWatcher defaultMode="dark" />
<Tooltip.Provider delayDuration={400}>
  {@render children()}
</Tooltip.Provider>
<Toaster position="top-center" richColors closeButton />
