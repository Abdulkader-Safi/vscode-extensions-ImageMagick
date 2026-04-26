<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { vscode } from "../vscodeApi";

    interface DirectoryItem {
        name: string;
        type: "file" | "directory";
    }

    interface DirectoryData {
        contents?: DirectoryItem[];
        path?: string;
        error?: string;
    }

    let directoryData = $state<DirectoryData | null>(null);
    let loading = $state(false);

    function handleMessage(event: MessageEvent) {
        const msg = event.data;
        if (msg?.type === "directoryContents") {
            directoryData = msg.data;
            loading = false;
        }
    }

    function handleLoadDirectory() {
        loading = true;
        vscode.postMessage({ type: "getDirectoryContents" });
    }

    onMount(() => {
        window.addEventListener("message", handleMessage);
        handleLoadDirectory();
    });

    onDestroy(() => {
        window.removeEventListener("message", handleMessage);
    });
</script>

<div class="max-w-3xl p-6">
    <header class="mb-6">
        <h1 class="mb-1 text-xl font-semibold">Directory</h1>
        <p class="text-sm text-vscode-description">
            Contents of the current workspace root, fetched via
            <code
                class="px-1 py-0.5 rounded font-mono text-xs bg-vscode-code-bg"
                >vscode.workspace.fs.readDirectory</code
            >.
        </p>
    </header>

    <div class="flex items-center gap-3 mb-4">
        <button
            type="button"
            onclick={handleLoadDirectory}
            disabled={loading}
            class="px-3 py-1 text-sm rounded-sm bg-vscode-button-secondary-bg text-vscode-button-secondary-fg hover:bg-vscode-button-secondary-hover focus:outline-2 focus:outline-vscode-focus disabled:opacity-50"
        >
            {loading ? "Refreshing…" : "Refresh"}
        </button>
        {#if directoryData?.path}
            <code
                class="flex-1 font-mono text-xs truncate text-vscode-description"
            >
                {directoryData.path}
            </code>
        {/if}
    </div>

    {#if directoryData?.error}
        <div class="p-3 text-sm rounded-sm bg-vscode-code-bg text-vscode-error">
            {directoryData.error}
        </div>
    {:else if directoryData?.contents && directoryData.contents.length > 0}
        <div class="border rounded-sm border-vscode-border">
            {#each directoryData.contents as item, i (i)}
                <div
                    class="flex items-center px-3 py-1 text-sm border-b last:border-b-0 border-vscode-border hover:bg-vscode-list-hover"
                >
                    <span class="mr-2 text-base leading-none">
                        {item.type === "directory" ? "📁" : "📄"}
                    </span>
                    <span class="flex-1 truncate">{item.name}</span>
                    <span
                        class="ml-2 text-[10px] uppercase tracking-wide text-vscode-description"
                    >
                        {item.type}
                    </span>
                </div>
            {/each}
        </div>
    {:else if directoryData && !loading}
        <p class="text-sm text-vscode-description">Directory is empty.</p>
    {/if}
</div>
