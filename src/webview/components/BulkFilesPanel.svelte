<script lang="ts">
    import type { BulkFileInfo } from "../../messages";

    interface Props {
        files: BulkFileInfo[];
        activeIndex: number;
        disabled: boolean;
        onSelect: (index: number) => void;
    }

    let { files, activeIndex, disabled, onSelect }: Props = $props();
</script>

<section class="p-3 space-y-2">
    <header class="flex items-center justify-between">
        <h2 class="text-xs font-semibold uppercase tracking-wide">
            Files ({files.length})
        </h2>
    </header>
    <p class="text-[11px] text-vscode-description">
        Edit settings on any file — the same pipeline is applied to all on Save
        All.
    </p>
    <ul class="flex flex-col -mx-1">
        {#each files as f, i (f.path)}
            <li>
                <button
                    type="button"
                    onclick={() => onSelect(i)}
                    {disabled}
                    title={f.path}
                    class="w-full flex items-center gap-2 px-2 py-1 text-xs text-left rounded-sm truncate disabled:opacity-50 {i ===
                    activeIndex
                        ? 'bg-vscode-button-bg text-vscode-button-fg'
                        : 'hover:bg-vscode-button-secondary-hover'}"
                >
                    <span
                        class="inline-block w-1.5 h-1.5 rounded-full {i ===
                        activeIndex
                            ? 'bg-vscode-button-fg'
                            : 'bg-vscode-description/50'}"
                    ></span>
                    <span class="truncate">{f.name}</span>
                </button>
            </li>
        {/each}
    </ul>
</section>
