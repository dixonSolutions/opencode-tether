<script lang="ts">
	import { Switch as SwitchPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		checked = $bindable(false),
		size = "default",
		...restProps
	}: WithoutChildrenOrChild<SwitchPrimitive.RootProps> & {
		size?: "sm" | "default";
	} = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	data-size={size}
	class={cn(
		"focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive focus-visible:ring-3 aria-invalid:ring-3 relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50",
		size === "sm" ? "h-6 w-10" : "h-7 w-12",
		checked ? "bg-primary" : "bg-muted-foreground/35 dark:bg-muted-foreground/30",
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		data-slot="switch-thumb"
		class={cn(
			"pointer-events-none block rounded-full bg-white shadow-sm ring-0 transition-transform",
			size === "sm" ? "size-5" : "size-6",
			checked ? (size === "sm" ? "translate-x-[18px]" : "translate-x-[22px]") : "translate-x-0.5"
		)}
	/>
</SwitchPrimitive.Root>
