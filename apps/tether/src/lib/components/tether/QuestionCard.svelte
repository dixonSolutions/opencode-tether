<script lang="ts">
  import type { QuestionRequest } from '$lib/api/types';
  import { app } from '$lib/state/app.svelte';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Root as Input } from '$lib/components/ui/input/index.js';
  import { cn } from '$lib/utils';
  import MessageCircleQuestion from '@lucide/svelte/icons/message-circle-question';
  import Check from '@lucide/svelte/icons/check';
  import Send from '@lucide/svelte/icons/send';

  let { request }: { request: QuestionRequest } = $props();
  let selections = $state<string[][]>([]);
  let custom = $state<string[]>([]);
  let submitting = $state(false);
  let initialized = '';

  $effect(() => {
    if (request.id !== initialized) {
      initialized = request.id;
      selections = request.questions.map(() => []);
      custom = request.questions.map(() => '');
    }
  });

  function toggle(questionIndex: number, label: string, multiple: boolean) {
    const current = selections[questionIndex] ?? [];
    if (multiple) {
      selections[questionIndex] = current.includes(label) ? current.filter((item) => item !== label) : [...current, label];
    } else {
      selections[questionIndex] = [label];
      custom[questionIndex] = '';
    }
  }

  function isSelected(questionIndex: number, label: string): boolean {
    return selections[questionIndex]?.includes(label) ?? false;
  }

  function answerFor(index: number): string[] {
    const typed = custom[index]?.trim();
    if (typed) return [typed];
    return selections[index] ?? [];
  }

  const complete = $derived(request.questions.every((_, index) => answerFor(index).length > 0));

  async function submit() {
    if (!complete) return;
    submitting = true;
    await app.replyQuestion(
      request.id,
      request.questions.map((_, index) => answerFor(index))
    );
    submitting = false;
  }
</script>

<div class="overflow-hidden rounded-xl border border-sky-500/25 bg-sky-500/[0.05] shadow-[0_10px_40px_rgba(0,0,0,0.16)] backdrop-blur">
  <div class="flex items-start gap-2.5 px-3 py-2.5">
    <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-sky-500/25 bg-sky-500/10 text-sky-300">
      <MessageCircleQuestion class="size-3.5" />
    </span>
    <div class="min-w-0 flex-1 space-y-3">
      {#each request.questions as question, index}
        <div>
          {#if question.header}<div class="text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-300/70">{question.header}</div>{/if}
          <div class="text-[12.5px] font-medium leading-snug text-foreground/95">{question.question}</div>
          <div class="mt-1.5 space-y-1">
            {#each question.options ?? [] as option}
              <button
                type="button"
                class={cn(
                  'flex w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                  isSelected(index, option.label)
                    ? 'border-sky-400/40 bg-sky-400/10'
                    : 'border-border/60 bg-background/30 hover:border-border hover:bg-muted/40'
                )}
                onclick={() => toggle(index, option.label, !!question.multiple)}
              >
                <span
                  class={cn(
                    'mt-0.5 grid size-4 shrink-0 place-items-center border',
                    question.multiple ? 'rounded-[4px]' : 'rounded-full',
                    isSelected(index, option.label) ? 'border-sky-400 bg-sky-400 text-sky-950' : 'border-border'
                  )}
                >
                  {#if isSelected(index, option.label)}<Check class="size-2.5" strokeWidth={3} />{/if}
                </span>
                <span class="min-w-0">
                  <span class="block text-[11.5px] font-medium">{option.label}</span>
                  {#if option.description}<span class="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{option.description}</span>{/if}
                </span>
              </button>
            {/each}
            {#if question.custom !== false}
              <Input
                bind:value={custom[index]}
                placeholder="Type another answer…"
                class="h-8 text-[11.5px]"
                oninput={() => {
                  if (custom[index]?.trim()) selections[index] = [];
                }}
              />
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
  <div class="flex items-center gap-1.5 border-t border-sky-500/15 bg-background/20 px-3 py-2">
    <Button variant="ghost" size="sm" class="h-7 text-[11px] text-muted-foreground" onclick={() => app.rejectQuestion(request.id)} disabled={submitting}>
      Dismiss
    </Button>
    <Button size="sm" class="ml-auto h-7 gap-1.5 bg-sky-400/90 text-[11px] text-sky-950 hover:bg-sky-300" onclick={submit} disabled={!complete || submitting}>
      <Send class="size-3" /> Send answer
    </Button>
  </div>
</div>
