<script lang="ts">
    interface Props {
        canSave: boolean;
        saving: boolean;
        saveStatus: string | null;
        previewMeta: { width: number; height: number; sizeKb: number } | null;
        onSave: () => void;
        onReset: () => void;
    }

    let { canSave, saving, saveStatus, previewMeta, onSave, onReset }: Props =
        $props();
</script>

<footer
    class="flex items-center gap-3 px-4 py-2 border-t border-vscode-border bg-vscode-section-bg"
>
    <div class="flex-1 text-xs text-vscode-description truncate">
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
    </div>

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
        class="px-3 py-1 text-sm rounded-sm bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover focus:outline-2 focus:outline-vscode-focus disabled:opacity-50"
    >
        {saving ? "Saving…" : "Save As…"}
    </button>
</footer>
