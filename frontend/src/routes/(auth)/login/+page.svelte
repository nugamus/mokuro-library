<script lang="ts">
	import { apiFetch } from '$lib/api';
	import { user } from '$lib/authStore';
	import { goto } from '$app/navigation';

	let username = '';
	let password = '';
	let error: string | null = null;
	let isLoading = false;

	async function handleLogin() {
		isLoading = true;
		error = null;

		try {
			const userData = await apiFetch('/api/auth/login', {
				method: 'POST',
				body: { username, password }
			});

			// Update the global store with the user data
			user.set(userData);

			// Redirect to the homepage
			await goto('/');
		} catch (e) {
			error = (e as Error).message;
		} finally {
			isLoading = false;
		}
	}
</script>

<h1 class="mb-6 text-center text-3xl font-bold text-gray-900 dark:text-white">Log In</h1>

<form on:submit|preventDefault={handleLogin} class="space-y-6">
	<div>
		<label for="username" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
			Username
		</label>
		<input
			id="username"
			type="text"
			bind:value={username}
			required
			class="mt-1 block w-full rounded-md border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
		/>
	</div>

	<div>
		<label for="password" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
			Password
		</label>
		<input
			id="password"
			type="password"
			bind:value={password}
			required
			class="mt-1 block w-full rounded-md border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
		/>
	</div>

	{#if error}
		<p class="text-sm text-red-600 dark:text-red-400">
			{error}
		</p>
	{/if}

	<button
		type="submit"
		disabled={isLoading}
		class="w-full justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
	>
		{isLoading ? 'Logging in...' : 'Log In'}
	</button>

	<p class="text-center text-sm text-gray-600 dark:text-gray-400">
		Don't have an account?
		<a
			href="/register"
			class="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
		>
			Sign up
		</a>
	</p>
</form>
