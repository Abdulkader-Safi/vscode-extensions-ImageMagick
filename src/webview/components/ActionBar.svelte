<script lang="ts">
    interface Props {
        canSave: boolean;
        saving: boolean;
        saveStatus: string | null;
        previewMeta: { width: number; height: number; sizeKb: number } | null;
        bulkCount: number;
        onSave: () => void;
        onBulkSave: () => void;
        onReset: () => void;
        onSavePreset: () => void;
    }

    let {
        canSave,
        saving,
        saveStatus,
        previewMeta,
        bulkCount,
        onSave,
        onBulkSave,
        onReset,
        onSavePreset,
    }: Props = $props();
</script>

<footer
    class="flex items-center gap-3 px-4 py-2 border-t border-vscode-border bg-vscode-section-bg"
>
    <div class="flex-1 flex items-center gap-3 text-xs text-vscode-description truncate min-w-0">
        <span class="truncate">
            {#if saving && saveStatus}
                {saveStatus}
            {:else if previewMeta}
                {previewMeta.width}×{previewMeta.height}
                {#if previewMeta.sizeKb > 0}
                    · {previewMeta.sizeKb} KB
                {/if}
            {:else}
                &nbsp;
            {/if}
        </span>
        <span class="ml-auto whitespace-nowrap opacity-70">
            developed by
            <a
                href="https://abdulkadersafi.com/?utm_source=vscode&utm_medium=extension&utm_campaign=imagemagick&utm_content=action-bar"
                target="_blank"
                rel="noopener noreferrer"
                class="underline hover:text-vscode-fg"
            >
                Abdulkader Safi
            </a>
        </span>
    </div>

    <button
        type="button"
        onclick={onSavePreset}
        disabled={!canSave}
        class="px-3 py-1 text-sm rounded-sm bg-vscode-button-secondary-bg text-vscode-button-secondary-fg hover:bg-vscode-button-secondary-hover disabled:opacity-50"
    >
        Save as preset
    </button>
    <button
        type="button"
        onclick={onReset}
        disabled={!canSave}
        class="px-3 py-1 text-sm rounded-sm bg-vscode-button-secondary-bg text-vscode-button-secondary-fg hover:bg-vscode-button-secondary-hover disabled:opacity-50"
    >
        Reset
    </button>
    <button
        type="button"
        onclick={onSave}
        disabled={!canSave}
        class="px-3 py-1 text-sm rounded-sm bg-vscode-button-secondary-bg text-vscode-button-secondary-fg hover:bg-vscode-button-secondary-hover disabled:opacity-50"
    >
        {saving && bulkCount === 0 ? "Saving…" : "Save As…"}
    </button>
    {#if bulkCount > 1}
        <button
            type="button"
            onclick={onBulkSave}
            disabled={!canSave}
            class="px-3 py-1 text-sm rounded-sm bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover focus:outline-2 focus:outline-vscode-focus disabled:opacity-50"
        >
            {saving ? "Saving…" : `Save All (${bulkCount})`}
        </button>
    {/if}
</footer>
