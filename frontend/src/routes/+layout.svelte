<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	import { onMount } from 'svelte';
	import { checkAuth } from '$lib/authStore';

	let { children } = $props();

	onMount(() => {
		checkAuth();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
