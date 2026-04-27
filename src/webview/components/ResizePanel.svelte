<script lang="ts">
    import type { ResizeSpec } from "../../messages";

    interface Props {
        resize: ResizeSpec | null;
        sourceWidth: number;
        sourceHeight: number;
    }

    let { resize = $bindable(), sourceWidth, sourceHeight }: Props = $props();

    let enabled = $state(resize !== null);
    let lockAspect = $state(true);
    // Source dimensions are stable for the lifetime of this component (a new
    // image opens a new editor panel) so seeding $state from props is fine.
    // svelte-ignore state_referenced_locally
    let widthInput = $state(sourceWidth);
    // svelte-ignore state_referenced_locally
    let heightInput = $state(sourceHeight);

    // Initialize / sync when toggled
    $effect(() => {
        if (enabled) {
            resize = {
                width: widthInput,
                height: heightInput,
                lockAspect,
            };
        } else {
            resize = null;
        }
    });

    function setWidth(value: number) {
        widthInput = clamp(value);
        if (lockAspect && sourceWidth > 0) {
            heightInput = Math.max(
                1,
                Math.round((widthInput / sourceWidth) * sourceHeight),
            );
        }
    }

    function setHeight(value: number) {
        heightInput = clamp(value);
        if (lockAspect && sourceHeight > 0) {
            widthInput = Math.max(
                1,
                Math.round((heightInput / sourceHeight) * sourceWidth),
            );
        }
    }

    function setPercent(percent: number) {
        widthInput = Math.max(1, Math.round((sourceWidth * percent) / 100));
        heightInput = Math.max(1, Math.round((sourceHeight * percent) / 100));
    }

    function clamp(n: number): number {
        if (!Number.isFinite(n)) {
            return 1;
        }
        return Math.max(1, Math.min(20000, Math.round(n)));
    }
</script>

<section class="p-3 space-y-2">
    <header class="flex items-center justify-between">
        <h2 class="text-xs font-semibold uppercase tracking-wide">Resize</h2>
        <label class="flex items-center gap-1 text-xs">
            <input
                type="checkbox"
                bind:checked={enabled}
                class="accent-vscode-focus"
            />
            <span>Enabled</span>
        </label>
    </header>

    <div class="grid grid-cols-2 gap-2 text-xs" class:opacity-50={!enabled}>
        <label class="flex flex-col gap-1">
            <span>Width</span>
            <input
                type="number"
                min="1"
                value={widthInput}
                oninput={(e) =>
                    setWidth(
                        Number((e.currentTarget as HTMLInputElement).value),
                    )}
                disabled={!enabled}
                class="px-2 py-1 border rounded-sm outline-none bg-vscode-input-bg text-vscode-input-fg border-vscode-input-border focus:border-vscode-focus"
            />
        </label>
        <label class="flex flex-col gap-1">
            <span>Height</span>
            <input
                type="number"
                min="1"
                value={heightInput}
                oninput={(e) =>
                    setHeight(
                        Number((e.currentTarget as HTMLInputElement).value),
                    )}
                disabled={!enabled}
                class="px-2 py-1 border rounded-sm outline-none bg-vscode-input-bg text-vscode-input-fg border-vscode-input-border focus:border-vscode-focus"
            />
        </label>
    </div>

    <label class="flex items-center gap-1 text-xs">
        <input
            type="checkbox"
            bind:checked={lockAspect}
            disabled={!enabled}
            class="accent-vscode-focus"
        />
        <span>Lock aspect ratio</span>
    </label>

    <div class="flex flex-wrap gap-1">
        {#each [25, 50, 75, 150, 200] as p (p)}
            <button
                type="button"
                onclick={() => setPercent(p)}
                disabled={!enabled}
                class="px-2 py-0.5 text-[11px] rounded-sm bg-vscode-button-secondary-bg text-vscode-button-secondary-fg hover:bg-vscode-button-secondary-hover disabled:opacity-50"
            >
                {p}%
            </button>
        {/each}
    </div>
</section>
