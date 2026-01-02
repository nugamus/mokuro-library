if (!globalThis.crypto) {
	globalThis.crypto = {
		randomUUID: () => 'test-uuid'
	} as Crypto;
}
