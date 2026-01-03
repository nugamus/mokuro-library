if (!globalThis.crypto) {
	globalThis.crypto = {
		randomUUID: () => 'test-uuid',
		subtle: {} as SubtleCrypto,
		getRandomValues: <T extends ArrayBufferView | null>(array: T): T => array as T
	} as Crypto;
}

if (!Element.prototype.animate) {
	Element.prototype.animate = () =>
		({
			cancel: () => {},
			finished: Promise.resolve()
		}) as unknown as Animation;
}

if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
	const store = new Map<string, string>();
	globalThis.localStorage = {
		getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
		setItem: (key: string, value: string) => {
			store.set(key, String(value));
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		}
	} as Storage;
}

if (!window.matchMedia) {
	window.matchMedia = (query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		}) as MediaQueryList;
}
