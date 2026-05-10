<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { send, onHostMessage } from "../messageBus";
    import type {
        BulkFileInfo,
        CropRect,
        EditorState,
        ImageFormat,
        ResizeSpec,
        SourceInfo,
    } from "../../messages";
    import PreviewCanvas from "../components/PreviewCanvas.svelte";
    import ResizePanel from "../components/ResizePanel.svelte";
    import CompressPanel from "../components/CompressPanel.svelte";
    import FormatPanel from "../components/FormatPanel.svelte";
    import RotatePanel from "../components/RotatePanel.svelte";
    import CropPanel from "../components/CropPanel.svelte";
    import BulkFilesPanel from "../components/BulkFilesPanel.svelte";
    import ActionBar from "../components/ActionBar.svelte";

    let source = $state<SourceInfo | null>(null);
    let availableFormats = $state<ImageFormat[]>([
        "jpg",
        "png",
        "webp",
        "gif",
        "tiff",
        "bmp",
    ]);
    let previewDataUrl = $state<string | null>(null);
    let previewMeta = $state<{
        width: number;
        height: number;
        sizeKb: number;
    } | null>(null);
    let errorMessage = $state<string | null>(null);
    let saving = $state(false);
    let saveStatus = $state<string | null>(null);
    let busyPreview = $state(false);

    // Bulk mode state
    let bulkFiles = $state<BulkFileInfo[]>([]);
    let activeIndex = $state(0);

    // Pipeline state
    let crop = $state<CropRect | null>(null);
    let rotate = $state(0);
    let flipH = $state(false);
    let flipV = $state(false);
    let resize = $state<ResizeSpec | null>(null);
    let format = $state<ImageFormat>("png");
    let quality = $state(85);

    let firstStateInit = true;
    let previewTimer: ReturnType<typeof setTimeout> | null = null;

    const editorState = $derived<EditorState>({
        crop,
        rotate,
        flipH,
        flipV,
        resize,
        format,
        quality,
    });

    // Drive preview requests whenever the pipeline state changes — debounced.
    $effect(() => {
        // Touch all reactive fields so this effect re-runs.
        void editorState;
        // Also depend on `source` so switching files re-renders the preview
        // with the current pipeline applied to the new image.
        void source;
        if (!source) {
            return;
        }
        if (firstStateInit) {
            // The host already sent the initial preview with `imageLoaded`.
            firstStateInit = false;
            return;
        }
        if (previewTimer) {
            clearTimeout(previewTimer);
        }
        // Snapshot the reactive proxy into a plain JS object — `postMessage`
        // uses structured-clone and chokes on Svelte $state proxies.
        const snapshot = $state.snapshot(editorState) as EditorState;
        previewTimer = setTimeout(() => {
            busyPreview = true;
            send({ type: "requestPreview", data: snapshot });
        }, 150);
    });

    let dispose: (() => void) | null = null;

    onMount(() => {
        dispose = onHostMessage((msg) => {
            switch (msg.type) {
                case "formatsAvailable":
                    availableFormats = msg.data.formats;
                    if (!availableFormats.includes(format)) {
                        format = availableFormats[0] ?? "png";
                    }
                    break;
                case "bulkInfo":
                    bulkFiles = msg.data.files;
                    activeIndex = msg.data.activeIndex;
                    break;
                case "imageLoaded":
                    source = {
                        path: msg.data.path,
                        name: msg.data.name,
                        width: msg.data.width,
                        height: msg.data.height,
                        format: msg.data.format,
                    };
                    previewDataUrl = msg.data.previewDataUrl;
                    previewMeta = {
                        width: msg.data.width,
                        height: msg.data.height,
                        sizeKb: 0,
                    };
                    format = guessFormat(msg.data.format);
                    firstStateInit = true;
                    errorMessage = null;
                    break;
                case "bulkActiveChanged":
                    // Switching files inside a bulk session: keep the user's
                    // pipeline settings, just update the source. The $effect
                    // on `source` will trigger a fresh preview render.
                    source = {
                        path: msg.data.path,
                        name: msg.data.name,
                        width: msg.data.width,
                        height: msg.data.height,
                        format: msg.data.format,
                    };
                    activeIndex = msg.data.activeIndex;
                    previewMeta = {
                        width: msg.data.width,
                        height: msg.data.height,
                        sizeKb: 0,
                    };
                    firstStateInit = false;
                    busyPreview = true;
                    errorMessage = null;
                    break;
                case "previewUpdated":
                    previewDataUrl = msg.data.previewDataUrl;
                    previewMeta = {
                        width: msg.data.width,
                        height: msg.data.height,
                        sizeKb: msg.data.sizeKb,
                    };
                    busyPreview = false;
                    break;
                case "saveStatus":
                    saveStatus = msg.data.message;
                    break;
                case "saveDone":
                    saving = false;
                    saveStatus = null;
                    break;
                case "saveCanceled":
                    saving = false;
                    saveStatus = null;
                    break;
                case "bulkSaveProgress":
                    saveStatus = `Saving ${msg.data.current}/${msg.data.total}: ${msg.data.name}`;
                    break;
                case "bulkSaveDone":
                    saving = false;
                    saveStatus = null;
                    break;
                case "error":
                    errorMessage = msg.data.message;
                    busyPreview = false;
                    saving = false;
                    saveStatus = null;
                    break;
            }
        });
        send({ type: "ready" });
    });

    onDestroy(() => {
        dispose?.();
        if (previewTimer) {
            clearTimeout(previewTimer);
        }
    });

    function guessFormat(raw: string): ImageFormat {
        const f = raw.toLowerCase();
        if (f === "jpeg" || f === "jpg") {
            return "jpg";
        }
        if (f === "png") {
            return "png";
        }
        if (f === "webp") {
            return "webp";
        }
        if (f === "avif") {
            return "avif";
        }
        if (f === "gif") {
            return "gif";
        }
        if (f === "tiff" || f === "tif") {
            return "tiff";
        }
        if (f === "bmp") {
            return "bmp";
        }
        return "png";
    }

    function handleSave() {
        if (!source) {
            return;
        }
        saving = true;
        saveStatus = "Preparing…";
        send({
            type: "requestSave",
            data: $state.snapshot(editorState) as EditorState,
        });
    }

    function handleBulkSave() {
        if (!source || bulkFiles.length < 2) {
            return;
        }
        saving = true;
        saveStatus = "Preparing…";
        send({
            type: "requestBulkSave",
            data: $state.snapshot(editorState) as EditorState,
        });
    }

    function handleReset() {
        crop = null;
        rotate = 0;
        flipH = false;
        flipV = false;
        resize = null;
        quality = 85;
        if (source) {
            format = guessFormat(source.format);
        }
        errorMessage = null;
    }

    function handleSelectBulkFile(index: number) {
        if (saving) {
            return;
        }
        if (index === activeIndex) {
            return;
        }
        send({ type: "selectBulkFile", data: { index } });
    }

    function handleDropFile(file: File) {
        file.arrayBuffer().then((buf) => {
            const bytes = Array.from(new Uint8Array(buf));
            // Drag-drop replaces the bulk session with a single buffer source.
            bulkFiles = [];
            activeIndex = 0;
            send({ type: "dropFile", data: { name: file.name, bytes } });
        });
    }
</script>

<div class="flex flex-col h-full text-vscode-fg bg-vscode-bg">
    <div class="flex flex-1 min-h-0">
        <aside
            class="flex flex-col w-72 border-r overflow-y-auto bg-vscode-sidebar-bg text-vscode-sidebar-fg border-vscode-sidebar-border"
        >
            <div
                class="px-4 py-2 text-xs font-semibold tracking-wide uppercase bg-vscode-section-bg text-vscode-section-fg"
            >
                ImageMagick
            </div>

            {#if source}
                <div
                    class="px-4 py-2 text-xs text-vscode-description border-b border-vscode-sidebar-border truncate"
                >
                    {source.name}
                    <span class="ml-1 opacity-70"
                        >{source.width}×{source.height}</span
                    >
                </div>
                <div
                    class="flex flex-col divide-y divide-vscode-sidebar-border"
                >
                    {#if bulkFiles.length > 1}
                        <BulkFilesPanel
                            files={bulkFiles}
                            {activeIndex}
                            disabled={saving}
                            onSelect={handleSelectBulkFile}
                        />
                    {/if}
                    <ResizePanel
                        bind:resize
                        sourceWidth={source.width}
                        sourceHeight={source.height}
                    />
                    <CropPanel
                        bind:crop
                        sourceWidth={source.width}
                        sourceHeight={source.height}
                    />
                    <RotatePanel bind:rotate bind:flipH bind:flipV />
                    <FormatPanel bind:format available={availableFormats} />
                    <CompressPanel bind:quality {format} />
                </div>
            {:else}
                <div class="p-4 text-sm text-vscode-description">
                    Drop an image into the preview area, or run
                    <code
                        class="px-1 py-0.5 rounded font-mono text-xs bg-vscode-code-bg"
                        >ImageMagick: Open Image</code
                    >
                    from the command palette.
                </div>
            {/if}
        </aside>

        <main
            class="flex-1 flex items-center justify-center overflow-auto p-4 min-w-0"
        >
            <PreviewCanvas
                {previewDataUrl}
                {source}
                bind:crop
                busy={busyPreview}
                onDrop={handleDropFile}
            />
        </main>
    </div>

    {#if errorMessage}
        <div
            class="px-4 py-2 text-xs text-vscode-error border-t border-vscode-border bg-vscode-code-bg"
        >
            {errorMessage}
        </div>
    {/if}

    <ActionBar
        canSave={!!source && !saving}
        {saving}
        {saveStatus}
        {previewMeta}
        bulkCount={bulkFiles.length}
        onSave={handleSave}
        onBulkSave={handleBulkSave}
        onReset={handleReset}
    />
</div>
