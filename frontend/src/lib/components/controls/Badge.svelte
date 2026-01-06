<script lang="ts">
	let { class: className = '' } = $props<{
		class?: string;
	}>();

	let badgeClass = $derived(
		() =>
			`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`.trim()
	);
</script>

<span class={badgeClass}>
	<slot />
</span>
