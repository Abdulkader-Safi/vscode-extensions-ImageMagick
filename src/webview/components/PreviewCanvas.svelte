<script lang="ts">
    import type { CropRect, SourceInfo } from "../../messages";

    interface Props {
        previewDataUrl: string | null;
        source: SourceInfo | null;
        crop: CropRect | null;
        busy: boolean;
        onDrop: (file: File) => void;
    }

    let {
        previewDataUrl,
        source,
        crop = $bindable(),
        busy,
        onDrop,
    }: Props = $props();

    type Corner = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

    type DragMode =
        | { kind: "create"; startX: number; startY: number; endX: number; endY: number }
        | {
              kind: "move";
              startX: number;
              startY: number;
              orig: CropRect;
          }
        | {
              kind: "resize";
              corner: Corner;
              startX: number;
              startY: number;
              orig: CropRect;
          };

    /** Hit-test radius (in display px) around handles. */
    const HANDLE_HIT = 10;

    let imgEl = $state<HTMLImageElement | null>(null);
    let containerEl = $state<HTMLDivElement | null>(null);
    let dragOver = $state(false);
    let imgRect = $state<DOMRect | null>(null);
    let dragMode = $state<DragMode | null>(null);
    let hoverCursor = $state<string>("crosshair");

    // Recompute the image's bounding rect on layout changes so display↔source
    // coordinate mapping stays accurate.
    $effect(() => {
        if (!imgEl) {
            imgRect = null;
            return;
        }
        const update = () => {
            imgRect = imgEl ? imgEl.getBoundingClientRect() : null;
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(imgEl);
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            ro.disconnect();
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    });

    function clampInt(n: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, Math.round(n)));
    }

    function displayToSource(
        dx: number,
        dy: number,
    ): { x: number; y: number } | null {
        if (
            !source ||
            !imgRect ||
            imgRect.width === 0 ||
            imgRect.height === 0
        ) {
            return null;
        }
        const ratioX = source.width / imgRect.width;
        const ratioY = source.height / imgRect.height;
        return {
            x: clampInt(dx * ratioX, 0, source.width),
            y: clampInt(dy * ratioY, 0, source.height),
        };
    }

    function sourceToDisplay(
        rect: CropRect,
    ): { left: number; top: number; width: number; height: number } | null {
        if (
            !source ||
            !imgRect ||
            imgRect.width === 0 ||
            imgRect.height === 0
        ) {
            return null;
        }
        const ratioX = imgRect.width / source.width;
        const ratioY = imgRect.height / source.height;
        return {
            left: rect.x * ratioX,
            top: rect.y * ratioY,
            width: rect.w * ratioX,
            height: rect.h * ratioY,
        };
    }

    function hitTestHandle(
        x: number,
        y: number,
        d: { left: number; top: number; width: number; height: number },
    ): Corner | null {
        const left = d.left;
        const top = d.top;
        const right = d.left + d.width;
        const bottom = d.top + d.height;
        const cx = d.left + d.width / 2;
        const cy = d.top + d.height / 2;
        const near = (px: number, py: number) =>
            Math.abs(x - px) <= HANDLE_HIT && Math.abs(y - py) <= HANDLE_HIT;
        if (near(left, top)) {
            return "nw";
        }
        if (near(right, top)) {
            return "ne";
        }
        if (near(left, bottom)) {
            return "sw";
        }
        if (near(right, bottom)) {
            return "se";
        }
        if (near(cx, top)) {
            return "n";
        }
        if (near(cx, bottom)) {
            return "s";
        }
        if (near(left, cy)) {
            return "w";
        }
        if (near(right, cy)) {
            return "e";
        }
        return null;
    }

    function isInsideCrop(
        x: number,
        y: number,
        d: { left: number; top: number; width: number; height: number },
    ): boolean {
        return (
            x > d.left &&
            x < d.left + d.width &&
            y > d.top &&
            y < d.top + d.height
        );
    }

    function cursorForCorner(c: Corner): string {
        switch (c) {
            case "nw":
            case "se":
                return "nwse-resize";
            case "ne":
            case "sw":
                return "nesw-resize";
            case "n":
            case "s":
                return "ns-resize";
            case "e":
            case "w":
                return "ew-resize";
        }
    }

    function handlePointerDown(event: PointerEvent) {
        if (!source || !imgRect) {
            return;
        }
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        const x = event.clientX - imgRect.left;
        const y = event.clientY - imgRect.top;

        // If we already have a crop, prefer move/resize when the pointer is on
        // it. Anywhere else starts a fresh selection.
        if (crop) {
            const display = sourceToDisplay(crop);
            if (display) {
                const handle = hitTestHandle(x, y, display);
                if (handle) {
                    dragMode = {
                        kind: "resize",
                        corner: handle,
                        startX: x,
                        startY: y,
                        orig: { ...crop },
                    };
                    return;
                }
                if (isInsideCrop(x, y, display)) {
                    dragMode = {
                        kind: "move",
                        startX: x,
                        startY: y,
                        orig: { ...crop },
                    };
                    return;
                }
            }
        }
        dragMode = { kind: "create", startX: x, startY: y, endX: x, endY: y };
    }

    function handlePointerMove(event: PointerEvent) {
        if (!imgRect) {
            return;
        }
        const x = Math.max(
            0,
            Math.min(imgRect.width, event.clientX - imgRect.left),
        );
        const y = Math.max(
            0,
            Math.min(imgRect.height, event.clientY - imgRect.top),
        );

        if (!dragMode) {
            // Update the hover cursor so the user can discover handles/move.
            if (crop) {
                const display = sourceToDisplay(crop);
                if (display) {
                    const handle = hitTestHandle(x, y, display);
                    if (handle) {
                        hoverCursor = cursorForCorner(handle);
                        return;
                    }
                    if (isInsideCrop(x, y, display)) {
                        hoverCursor = "move";
                        return;
                    }
                }
            }
            hoverCursor = "crosshair";
            return;
        }

        if (dragMode.kind === "create") {
            dragMode = { ...dragMode, endX: x, endY: y };
            return;
        }

        if (dragMode.kind === "move") {
            applyMove(x, y, dragMode);
            return;
        }

        if (dragMode.kind === "resize") {
            applyResize(x, y, dragMode);
            return;
        }
    }

    function handlePointerUp(event: PointerEvent) {
        if (!dragMode) {
            return;
        }
        (event.currentTarget as HTMLElement).releasePointerCapture(
            event.pointerId,
        );

        if (dragMode.kind === "create") {
            const sel = dragMode;
            dragMode = null;
            const dx = Math.abs(sel.endX - sel.startX);
            const dy = Math.abs(sel.endY - sel.startY);
            if (dx < 5 || dy < 5) {
                // Treat tiny drags as a click — clear any existing crop.
                crop = null;
                return;
            }
            const minX = Math.min(sel.startX, sel.endX);
            const minY = Math.min(sel.startY, sel.endY);
            const a = displayToSource(minX, minY);
            const b = displayToSource(minX + dx, minY + dy);
            if (!a || !b) {
                return;
            }
            crop = {
                x: a.x,
                y: a.y,
                w: Math.max(1, b.x - a.x),
                h: Math.max(1, b.y - a.y),
            };
            return;
        }

        // move and resize: nothing more to do — the crop is already updated.
        dragMode = null;
    }

    function applyMove(
        x: number,
        y: number,
        mode: Extract<DragMode, { kind: "move" }>,
    ) {
        if (!source || !imgRect) {
            return;
        }
        const ratioX = source.width / imgRect.width;
        const ratioY = source.height / imgRect.height;
        const dxSrc = (x - mode.startX) * ratioX;
        const dySrc = (y - mode.startY) * ratioY;

        let nx = Math.round(mode.orig.x + dxSrc);
        let ny = Math.round(mode.orig.y + dySrc);
        nx = Math.max(0, Math.min(source.width - mode.orig.w, nx));
        ny = Math.max(0, Math.min(source.height - mode.orig.h, ny));

        crop = { x: nx, y: ny, w: mode.orig.w, h: mode.orig.h };
    }

    function applyResize(
        x: number,
        y: number,
        mode: Extract<DragMode, { kind: "resize" }>,
    ) {
        if (!source || !imgRect) {
            return;
        }
        const ratioX = source.width / imgRect.width;
        const ratioY = source.height / imgRect.height;
        const dxSrc = (x - mode.startX) * ratioX;
        const dySrc = (y - mode.startY) * ratioY;

        let nx = mode.orig.x;
        let ny = mode.orig.y;
        let nw = mode.orig.w;
        let nh = mode.orig.h;

        const right = mode.orig.x + mode.orig.w;
        const bottom = mode.orig.y + mode.orig.h;

        const c = mode.corner;
        if (c === "nw" || c === "w" || c === "sw") {
            // Left edge moves; right edge stays put.
            nx = Math.round(mode.orig.x + dxSrc);
            nx = Math.max(0, Math.min(right - 1, nx));
            nw = right - nx;
        }
        if (c === "ne" || c === "e" || c === "se") {
            // Right edge moves; left edge stays put.
            nw = Math.round(mode.orig.w + dxSrc);
            nw = Math.max(1, Math.min(source.width - mode.orig.x, nw));
        }
        if (c === "nw" || c === "n" || c === "ne") {
            // Top edge moves; bottom edge stays put.
            ny = Math.round(mode.orig.y + dySrc);
            ny = Math.max(0, Math.min(bottom - 1, ny));
            nh = bottom - ny;
        }
        if (c === "sw" || c === "s" || c === "se") {
            // Bottom edge moves; top edge stays put.
            nh = Math.round(mode.orig.h + dySrc);
            nh = Math.max(1, Math.min(source.height - mode.orig.y, nh));
        }

        crop = { x: nx, y: ny, w: nw, h: nh };
    }

    function handleDragEnter(event: DragEvent) {
        event.preventDefault();
        dragOver = true;
    }

    function handleDragOver(event: DragEvent) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
    }

    function handleDragLeave(event: DragEvent) {
        if (event.target === containerEl) {
            dragOver = false;
        }
    }

    function handleDropEvent(event: DragEvent) {
        event.preventDefault();
        dragOver = false;
        const file = event.dataTransfer?.files?.[0];
        if (file) {
            onDrop(file);
        }
    }

    const dragRectStyle = $derived.by((): string | null => {
        if (!dragMode || dragMode.kind !== "create") {
            return null;
        }
        const left = Math.min(dragMode.startX, dragMode.endX);
        const top = Math.min(dragMode.startY, dragMode.endY);
        const width = Math.abs(dragMode.endX - dragMode.startX);
        const height = Math.abs(dragMode.endY - dragMode.startY);
        return `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
    });

    const cropDisplay = $derived.by(() => {
        if (!crop) {
            return null;
        }
        return sourceToDisplay(crop);
    });

    const cropRectStyle = $derived.by((): string | null => {
        if (!cropDisplay) {
            return null;
        }
        return `left:${cropDisplay.left}px;top:${cropDisplay.top}px;width:${cropDisplay.width}px;height:${cropDisplay.height}px`;
    });

    // Eight handle positions, computed off the displayed crop.
    const handles = $derived.by(() => {
        const d = cropDisplay;
        if (!d) {
            return [] as { corner: Corner; x: number; y: number }[];
        }
        const cx = d.left + d.width / 2;
        const cy = d.top + d.height / 2;
        const right = d.left + d.width;
        const bottom = d.top + d.height;
        return [
            { corner: "nw" as Corner, x: d.left, y: d.top },
            { corner: "n" as Corner, x: cx, y: d.top },
            { corner: "ne" as Corner, x: right, y: d.top },
            { corner: "e" as Corner, x: right, y: cy },
            { corner: "se" as Corner, x: right, y: bottom },
            { corner: "s" as Corner, x: cx, y: bottom },
            { corner: "sw" as Corner, x: d.left, y: bottom },
            { corner: "w" as Corner, x: d.left, y: cy },
        ];
    });
</script>

<div
    bind:this={containerEl}
    class="relative w-full h-full flex items-center justify-center {dragOver
        ? 'outline outline-2 outline-vscode-focus outline-offset-[-4px]'
        : ''}"
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDropEvent}
    role="region"
    aria-label="Image preview"
>
    {#if previewDataUrl && source}
        <div class="relative max-w-full max-h-full">
            <img
                bind:this={imgEl}
                src={previewDataUrl}
                alt={source.name}
                draggable="false"
                class="max-w-full max-h-[calc(100vh-160px)] block select-none"
                style="cursor:{hoverCursor}"
                onpointerdown={handlePointerDown}
                onpointermove={handlePointerMove}
                onpointerup={handlePointerUp}
                onpointercancel={handlePointerUp}
            />

            {#if cropRectStyle}
                <div
                    class="absolute border-2 border-vscode-focus pointer-events-none mix-blend-difference"
                    style={cropRectStyle}
                ></div>
                {#each handles as h (h.corner)}
                    <div
                        class="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] border border-vscode-focus bg-white pointer-events-none"
                        style="left:{h.x}px;top:{h.y}px"
                    ></div>
                {/each}
            {/if}
            {#if dragRectStyle}
                <div
                    class="absolute border-2 border-dashed border-vscode-focus pointer-events-none"
                    style={dragRectStyle}
                ></div>
            {/if}

            {#if busy}
                <div
                    class="absolute inset-0 flex items-center justify-center bg-vscode-bg/40 text-xs text-vscode-description pointer-events-none"
                >
                    Updating preview…
                </div>
            {/if}
        </div>
    {:else}
        <div
            class="flex flex-col items-center justify-center gap-1 px-6 py-12 text-sm text-vscode-description border border-dashed border-vscode-border rounded-sm"
        >
            <span class="text-base">Drop an image here</span>
            <span class="text-xs"
                >PNG · JPG · WebP · AVIF · GIF · TIFF · BMP</span
            >
        </div>
    {/if}
</div>
