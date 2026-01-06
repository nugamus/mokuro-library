<script lang="ts">
	import type { ComponentType } from 'svelte';

	let { icon, size, strokeWidth = 2, class: className = '' } = $props<{
		icon: ComponentType;
		size?: number;
		strokeWidth?: number;
		class?: string;
	}>();
</script>

{@const IconComponent = icon}
{#if IconComponent}
	<IconComponent class={className} size={size} strokeWidth={strokeWidth} />
{/if}
