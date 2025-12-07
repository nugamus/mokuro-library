<script lang="ts">
	let { variant = 'block', onResizeStart } = $props<{
		variant?: 'block' | 'line';
		onResizeStart: (e: MouseEvent, handle: string) => void;
	}>();

	// Styles from original OcrOverlay.svelte
	// Block: h-2 w-2 bg-blue-500 z-10
	// Line: h-1.5 w-1.5 bg-yellow-400 z-20 (positioned at -left-0.75 etc which is approx -3px)

	const baseClass =
		'absolute rounded-full opacity-0 group-hover/block:opacity-100 group-hover/line:opacity-100 transition-opacity';

	const variantClass =
		variant === 'block' ? 'z-10 h-2 w-2 bg-blue-500' : 'z-20 h-1.5 w-1.5 bg-yellow-400';

	// Offset classes

	const pos = (type: string) => {
		switch (type) {
			case 'tl':
				return '-left-1 -top-1';
			case 'tc':
				return '-top-1 left-1/2 -translate-x-1/2';
			case 'tr':
				return '-right-1 -top-1';
			case 'ml':
				return '-left-1 top-1/2 -translate-y-1/2';
			case 'mr':
				return '-right-1 top-1/2 -translate-y-1/2';
			case 'bl':
				return '-bottom-1 -left-1';
			case 'bc':
				return '-bottom-1 left-1/2 -translate-x-1/2';
			case 'br':
				return '-bottom-1 -right-1';
		}
		return '';
	};
</script>

<div
	class="{baseClass} {variantClass} {pos('tl')} cursor-nwse-resize"
	onmousedown={(e) => onResizeStart(e, 'top-left')}
	role="button"
	tabindex="-1"
></div>

<div
	class="{baseClass} {variantClass} {pos('tc')} cursor-ns-resize"
	onmousedown={(e) => onResizeStart(e, 'top-center')}
	role="button"
	tabindex="-1"
></div>

<div
	class="{baseClass} {variantClass} {pos('tr')} cursor-nesw-resize"
	onmousedown={(e) => onResizeStart(e, 'top-right')}
	role="button"
	tabindex="-1"
></div>

<div
	class="{baseClass} {variantClass} {pos('ml')} cursor-ew-resize"
	onmousedown={(e) => onResizeStart(e, 'middle-left')}
	role="button"
	tabindex="-1"
></div>

<div
	class="{baseClass} {variantClass} {pos('mr')} cursor-ew-resize"
	onmousedown={(e) => onResizeStart(e, 'middle-right')}
	role="button"
	tabindex="-1"
></div>

<div
	class="{baseClass} {variantClass} {pos('bl')} cursor-nesw-resize"
	onmousedown={(e) => onResizeStart(e, 'bottom-left')}
	role="button"
	tabindex="-1"
></div>

<div
	class="{baseClass} {variantClass} {pos('bc')} cursor-ns-resize"
	onmousedown={(e) => onResizeStart(e, 'bottom-center')}
	role="button"
	tabindex="-1"
></div>

<div
	class="{baseClass} {variantClass} {pos('br')} cursor-nwse-resize"
	onmousedown={(e) => onResizeStart(e, 'bottom-right')}
	role="button"
	tabindex="-1"
></div>
