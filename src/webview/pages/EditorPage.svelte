<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { send, onHostMessage } from "../messageBus";
    import {
        ImageService,
        getWritableFormats,
        encodeBytes,
    } from "../engine/imageEngine";
    import { streamOutbound, InboundAssembler } from "../transport";
    import type {
        BulkFileInfo,
        CropRect,
        EditorState,
        ImageFormat,
        InboundMeta,
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

    // The image engine runs here in the webview (ImageMagick WASM), so this
    // page owns one ImageService for the active edit session and talks to the
    // host only to read source bytes and write encoded output.
    const service = new ImageService();
    const inbound = new InboundAssembler();

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

    let hasLoadedOnce = false;
    let previewTimer: ReturnType<typeof setTimeout> | null = null;
    // Monotonic token so a slow preview render can't clobber a newer one.
    let previewSeq = 0;

    const editorState = $derived<EditorState>({
        crop,
        rotate,
        flipH,
        flipV,
        resize,
        format,
        quality,
    });

    // Re-render the preview whenever the pipeline or the source changes — the
    // work happens locally, debounced so dragging a slider doesn't thrash it.
    $effect(() => {
        // Touch reactive fields so this effect re-runs on any of them.
        void editorState;
        void source;
        if (!source) {
            return;
        }
        if (previewTimer) {
            clearTimeout(previewTimer);
        }
        const snapshot = $state.snapshot(editorState) as EditorState;
        previewTimer = setTimeout(() => {
            void renderPreview(snapshot);
        }, 150);
    });

    async function renderPreview(state: EditorState): Promise<void> {
        const seq = ++previewSeq;
        busyPreview = true;
        try {
            const result = await service.renderPreview(state);
            if (seq !== previewSeq) {
                return; // a newer render superseded this one
            }
            previewDataUrl = result.previewDataUrl;
            previewMeta = {
                width: result.width,
                height: result.height,
                sizeKb: result.sizeKb,
            };
            errorMessage = null;
        } catch (err) {
            if (seq === previewSeq) {
                errorMessage = describeError(err, "Failed to render preview");
            }
        } finally {
            if (seq === previewSeq) {
                busyPreview = false;
            }
        }
    }

    let dispose: (() => void) | null = null;

    onMount(() => {
        dispose = onHostMessage((msg) => {
            console.log("[ImageMagick] webview received:", msg.type);
            switch (msg.type) {
                case "bulkInfo":
                    bulkFiles = msg.data.files;
                    activeIndex = msg.data.activeIndex;
                    break;
                case "inBegin":
                    inbound.begin(
                        msg.data.id,
                        msg.data.total,
                        msg.data.meta,
                    );
                    break;
                case "inChunk": {
                    const done = inbound.chunk(msg.data.id, msg.data.b64);
                    if (done) {
                        void handleInbound(done.meta, done.bytes);
                    }
                    break;
                }
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
                default:
                    console.warn(
                        "[ImageMagick] unhandled message type (host/webview version mismatch?):",
                        (msg as { type?: string }).type,
                    );
            }
        });
        // Warm the engine and learn which formats it can actually encode.
        void initFormats();
        console.log("[ImageMagick] webview mounted, sending ready");
        send({ type: "ready" });
    });

    onDestroy(() => {
        dispose?.();
        if (previewTimer) {
            clearTimeout(previewTimer);
        }
    });

    async function initFormats(): Promise<void> {
        try {
            const writable = await getWritableFormats();
            availableFormats = Array.from(writable);
            if (source && !availableFormats.includes(format)) {
                format = availableFormats[0] ?? "png";
            }
        } catch {
            // Keep the default set; getWritableFormats already falls back.
        }
    }

    // Dispatches a fully-reassembled inbound byte stream from the host.
    async function handleInbound(
        meta: InboundMeta,
        bytes: Uint8Array,
    ): Promise<void> {
        console.log(
            "[ImageMagick] inbound complete:",
            meta.kind,
            bytes.length,
            "bytes",
        );
        if (meta.kind === "load") {
            await loadSource(bytes, meta.path, meta.name, meta.activeIndex);
            return;
        }
        // meta.kind === "bulk": encode this source and stream the result back.
        try {
            const state = $state.snapshot(editorState) as EditorState;
            const { bytes: outBytes } = await encodeBytes(bytes, state);
            streamOutbound(
                send,
                { kind: "bulk", index: meta.index, name: meta.name },
                outBytes,
            );
        } catch (err) {
            errorMessage = describeError(err, `Failed to encode ${meta.name}`);
            // Empty output so the host counts a failure and keeps going.
            streamOutbound(
                send,
                { kind: "bulk", index: meta.index, name: meta.name },
                new Uint8Array(0),
            );
        }
    }

    async function loadSource(
        bytes: Uint8Array,
        path: string | null,
        name: string,
        index: number,
    ): Promise<void> {
        try {
            const info = await service.loadFromBytes(bytes, path, name);
            console.log(
                "[ImageMagick] source loaded:",
                info.name,
                `${info.width}x${info.height}`,
                info.format,
            );
            source = info;
            activeIndex = index;
            previewMeta = {
                width: info.width,
                height: info.height,
                sizeKb: 0,
            };
            errorMessage = null;
            // First image of the session seeds the target format; switching
            // between bulk files keeps the user's chosen pipeline.
            if (!hasLoadedOnce) {
                hasLoadedOnce = true;
                const guessed = guessFormat(info.format);
                format = availableFormats.includes(guessed) ? guessed : format;
            }
            // The $effect on `source` will render the preview.
        } catch (err) {
            errorMessage = describeError(err, `Could not open ${name}`);
        }
    }

    function describeError(err: unknown, fallback: string): string {
        if (err instanceof Error) {
            return err.message || fallback;
        }
        if (typeof err === "string") {
            return err;
        }
        return fallback;
    }

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

    async function handleSave() {
        if (!source || saving) {
            return;
        }
        saving = true;
        saveStatus = "Encoding…";
        try {
            const state = $state.snapshot(editorState) as EditorState;
            const { bytes } = await service.encode(state);
            streamOutbound(
                send,
                {
                    kind: "save",
                    name: source.name,
                    path: source.path,
                    format: state.format,
                },
                bytes,
            );
        } catch (err) {
            saving = false;
            saveStatus = null;
            errorMessage = describeError(err, "Failed to encode image");
        }
    }

    function handleBulkSave() {
        if (!source || bulkFiles.length < 2 || saving) {
            return;
        }
        saving = true;
        saveStatus = "Preparing…";
        send({ type: "requestBulkSave" });
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
        // Drag-drop replaces the bulk session with a single buffer source,
        // loaded directly here without a round-trip to the host.
        file.arrayBuffer()
            .then((buf) => {
                bulkFiles = [];
                return loadSource(
                    new Uint8Array(buf),
                    null,
                    file.name,
                    0,
                );
            })
            .catch((err: unknown) => {
                errorMessage = describeError(err, `Could not open ${file.name}`);
            });
    }

    function handleDropUri(uri: string) {
        // Dropped from the VS Code Explorer: no File object, just a file: URI.
        // The host reads it off disk and streams it back as a `load`.
        send({ type: "openUri", data: { uri } });
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
                onDropUri={handleDropUri}
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
