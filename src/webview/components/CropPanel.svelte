<script lang="ts">
    import type { CropRect } from "../../messages";

    interface Props {
        crop: CropRect | null;
        sourceWidth: number;
        sourceHeight: number;
    }

    let { crop = $bindable(), sourceWidth, sourceHeight }: Props = $props();

    function clear() {
        crop = null;
    }

    function center(percent: number) {
        const w = Math.max(1, Math.round((sourceWidth * percent) / 100));
        const h = Math.max(1, Math.round((sourceHeight * percent) / 100));
        crop = {
            x: Math.round((sourceWidth - w) / 2),
            y: Math.round((sourceHeight - h) / 2),
            w,
            h,
        };
    }

    function update(field: "x" | "y" | "w" | "h", value: number) {
        if (!crop) {
            return;
        }
        const next = { ...crop };
        if (field === "x") {
            next.x = clampPos(value, sourceWidth);
        }
        if (field === "y") {
            next.y = clampPos(value, sourceHeight);
        }
        if (field === "w") {
            next.w = clampSize(value, sourceWidth);
        }
        if (field === "h") {
            next.h = clampSize(value, sourceHeight);
        }
        crop = next;
    }

    function clampPos(n: number, max: number): number {
        if (!Number.isFinite(n)) {
            return 0;
        }
        return Math.max(0, Math.min(max - 1, Math.round(n)));
    }

    function clampSize(n: number, max: number): number {
        if (!Number.isFinite(n)) {
            return 1;
        }
        return Math.max(1, Math.min(max, Math.round(n)));
    }
</script>

<section class="p-3 space-y-2">
    <header class="flex items-center justify-between">
        <h2 class="text-xs font-semibold uppercase tracking-wide">Crop</h2>
        {#if crop}
            <button
                type="button"
                onclick={clear}
                class="text-[11px] text-vscode-description underline hover:text-vscode-fg"
            >
                Clear
            </button>
        {/if}
    </header>

    <p class="text-[11px] text-vscode-description">
        Drag on the preview to define a crop region, or use the inputs below.
    </p>

    {#if crop}
        <div class="grid grid-cols-2 gap-2 text-xs">
            <label class="flex flex-col gap-1">
                <span>X</span>
                <input
                    type="number"
                    min="0"
                    value={crop.x}
                    oninput={(e) =>
                        update(
                            "x",
                            Number((e.currentTarget as HTMLInputElement).value),
                        )}
                    class="px-2 py-1 border rounded-sm outline-none bg-vscode-input-bg text-vscode-input-fg border-vscode-input-border focus:border-vscode-focus"
                />
            </label>
            <label class="flex flex-col gap-1">
                <span>Y</span>
                <input
                    type="number"
                    min="0"
                    value={crop.y}
                    oninput={(e) =>
                        update(
                            "y",
                            Number((e.currentTarget as HTMLInputElement).value),
                        )}
                    class="px-2 py-1 border rounded-sm outline-none bg-vscode-input-bg text-vscode-input-fg border-vscode-input-border focus:border-vscode-focus"
                />
            </label>
            <label class="flex flex-col gap-1">
                <span>Width</span>
                <input
                    type="number"
                    min="1"
                    value={crop.w}
                    oninput={(e) =>
                        update(
                            "w",
                            Number((e.currentTarget as HTMLInputElement).value),
                        )}
                    class="px-2 py-1 border rounded-sm outline-none bg-vscode-input-bg text-vscode-input-fg border-vscode-input-border focus:border-vscode-focus"
                />
            </label>
            <label class="flex flex-col gap-1">
                <span>Height</span>
                <input
                    type="number"
                    min="1"
                    value={crop.h}
                    oninput={(e) =>
                        update(
                            "h",
                            Number((e.currentTarget as HTMLInputElement).value),
                        )}
                    class="px-2 py-1 border rounded-sm outline-none bg-vscode-input-bg text-vscode-input-fg border-vscode-input-border focus:border-vscode-focus"
                />
            </label>
        </div>
    {/if}

    <div class="flex flex-wrap gap-1">
        {#each [25, 50, 75, 90] as p (p)}
            <button
                type="button"
                onclick={() => center(p)}
                class="px-2 py-0.5 text-[11px] rounded-sm bg-vscode-button-secondary-bg text-vscode-button-secondary-fg hover:bg-vscode-button-secondary-hover"
            >
                Center {p}%
            </button>
        {/each}
    </div>
</section>
