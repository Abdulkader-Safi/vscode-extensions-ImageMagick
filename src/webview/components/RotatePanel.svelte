<script lang="ts">
    interface Props {
        rotate: number;
        flipH: boolean;
        flipV: boolean;
    }

    let {
        rotate = $bindable(),
        flipH = $bindable(),
        flipV = $bindable(),
    }: Props = $props();

    function bumpRotate(delta: number) {
        rotate = (((rotate + delta) % 360) + 360) % 360;
    }
</script>

<section class="p-3 space-y-2">
    <header class="flex items-center justify-between">
        <h2 class="text-xs font-semibold uppercase tracking-wide">
            Rotate &amp; Flip
        </h2>
        <span class="text-xs text-vscode-description">{rotate}°</span>
    </header>

    <div class="flex gap-1">
        <button
            type="button"
            onclick={() => bumpRotate(-90)}
            class="flex-1 px-2 py-1 text-[11px] rounded-sm bg-vscode-button-secondary-bg text-vscode-button-secondary-fg hover:bg-vscode-button-secondary-hover"
        >
            −90°
        </button>
        <button
            type="button"
            onclick={() => bumpRotate(90)}
            class="flex-1 px-2 py-1 text-[11px] rounded-sm bg-vscode-button-secondary-bg text-vscode-button-secondary-fg hover:bg-vscode-button-secondary-hover"
        >
            +90°
        </button>
        <button
            type="button"
            onclick={() => bumpRotate(180)}
            class="flex-1 px-2 py-1 text-[11px] rounded-sm bg-vscode-button-secondary-bg text-vscode-button-secondary-fg hover:bg-vscode-button-secondary-hover"
        >
            180°
        </button>
    </div>

    <input
        type="range"
        min="-180"
        max="180"
        step="1"
        bind:value={rotate}
        class="w-full accent-vscode-focus"
    />

    <div class="flex gap-3 text-xs">
        <label class="flex items-center gap-1">
            <input
                type="checkbox"
                bind:checked={flipH}
                class="accent-vscode-focus"
            />
            <span>Flip H</span>
        </label>
        <label class="flex items-center gap-1">
            <input
                type="checkbox"
                bind:checked={flipV}
                class="accent-vscode-focus"
            />
            <span>Flip V</span>
        </label>
    </div>
</section>
