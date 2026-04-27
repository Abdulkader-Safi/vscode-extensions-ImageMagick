<script lang="ts">
    import type { ImageFormat } from "../../messages";

    interface Props {
        format: ImageFormat;
        available: ImageFormat[];
    }

    let { format = $bindable(), available }: Props = $props();

    const ALL_FORMATS: { value: ImageFormat; label: string }[] = [
        { value: "jpg", label: "JPEG" },
        { value: "png", label: "PNG" },
        { value: "webp", label: "WebP" },
        { value: "avif", label: "AVIF" },
        { value: "gif", label: "GIF" },
        { value: "tiff", label: "TIFF" },
        { value: "bmp", label: "BMP" },
    ];

    const formats = $derived(
        ALL_FORMATS.filter((f) => available.includes(f.value)),
    );
</script>

<section class="p-3 space-y-2">
    <h2 class="text-xs font-semibold uppercase tracking-wide">Format</h2>
    <div class="grid grid-cols-3 gap-1">
        {#each formats as f (f.value)}
            <button
                type="button"
                onclick={() => (format = f.value)}
                class="px-2 py-1 text-[11px] rounded-sm border {format ===
                f.value
                    ? 'bg-vscode-list-active-bg text-vscode-list-active-fg border-vscode-focus'
                    : 'bg-vscode-button-secondary-bg text-vscode-button-secondary-fg border-vscode-border hover:bg-vscode-button-secondary-hover'}"
            >
                {f.label}
            </button>
        {/each}
    </div>
</section>
