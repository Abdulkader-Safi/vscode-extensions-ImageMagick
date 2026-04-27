<script lang="ts">
    import type { ImageFormat } from "../../messages";

    interface Props {
        quality: number;
        format: ImageFormat;
    }

    let { quality = $bindable(), format }: Props = $props();

    const lossless = $derived(
        format === "png" ||
            format === "gif" ||
            format === "bmp" ||
            format === "tiff",
    );
</script>

<section class="p-3 space-y-2">
    <header class="flex items-center justify-between">
        <h2 class="text-xs font-semibold uppercase tracking-wide">
            Compression
        </h2>
        <span class="text-xs text-vscode-description">Quality {quality}</span>
    </header>

    <input
        type="range"
        min="1"
        max="100"
        bind:value={quality}
        disabled={lossless}
        class="w-full accent-vscode-focus"
    />

    {#if lossless}
        <p class="text-[11px] text-vscode-description">
            {format.toUpperCase()} is lossless — quality has no effect.
        </p>
    {:else}
        <p class="text-[11px] text-vscode-description">
            Lower values give smaller files at the cost of detail.
        </p>
    {/if}
</section>
