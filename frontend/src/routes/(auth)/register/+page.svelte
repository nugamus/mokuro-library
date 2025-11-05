<script lang="ts">
	import { apiFetch } from '$lib/api';
	import { goto } from '$app/navigation';

	let username = '';
	let password = '';
	let confirmPassword = '';
	let error: string | null = null;
	let isLoading = false;
	let successMessage: string | null = null;

	async function handleRegister() {
		isLoading = true;
		error = null;
		successMessage = null;

		// Add validation checks
		if (password.length < 6) {
			error = 'Password must be at least 6 characters long.';
			isLoading = false;
			return;
		}

		if (password !== confirmPassword) {
			error = 'Passwords do not match.';
			isLoading = false;
			return;
		}

		try {
			// Send only username and password to the API
			await apiFetch('/api/auth/register', {
				method: 'POST',
				body: { username, password }
			});

			// Show success and redirect
			successMessage = 'Account created! Redirecting to login...';
			setTimeout(() => {
				goto('/login');
			}, 2000);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			isLoading = false;
		}
	}
</script>

<h1 class="mb-6 text-center text-3xl font-bold text-gray-900 dark:text-white">Create Account</h1>

<form on:submit|preventDefault={handleRegister} class="space-y-6">
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
			Password (min. 6 characters)
		</label>
		<input
			id="password"
			type="password"
			bind:value={password}
			required
			class="mt-1 block w-full rounded-md border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
		/>
	</div>

	<div>
		<label for="confirmPassword" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
			Confirm Password
		</label>
		<input
			id="confirmPassword"
			type="password"
			bind:value={confirmPassword}
			required
			class="mt-1 block w-full rounded-md border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
		/>
	</div>

	{#if error}
		<p class="text-sm text-red-600 dark:text-red-400">
			{error}
		</p>
	{/if}

	{#if successMessage}
		<p class="text-sm text-green-600 dark:text-green-400">
			{successMessage}
		</p>
	{/if}

	<button
		type="submit"
		disabled={isLoading || successMessage !== null}
		class="w-full justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
	>
		{isLoading ? 'Creating...' : 'Create Account'}
	</button>

	<p class="text-center text-sm text-gray-600 dark:text-gray-400">
		Already have an account?
		<a href="/login" class="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
			Log in
		</a>
	</p>
</form>
