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

    let imgEl = $state<HTMLImageElement | null>(null);
    let containerEl = $state<HTMLDivElement | null>(null);
    let dragOver = $state(false);
    let imgRect = $state<DOMRect | null>(null);
    let dragSelect = $state<{
        startX: number;
        startY: number;
        endX: number;
        endY: number;
    } | null>(null);

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
            x: Math.max(0, Math.min(source.width, Math.round(dx * ratioX))),
            y: Math.max(0, Math.min(source.height, Math.round(dy * ratioY))),
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
        dragSelect = { startX: x, startY: y, endX: x, endY: y };
    }

    function handlePointerMove(event: PointerEvent) {
        if (!dragSelect || !imgRect) {
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
        dragSelect = { ...dragSelect, endX: x, endY: y };
    }

    function handlePointerUp(event: PointerEvent) {
        if (!dragSelect) {
            return;
        }
        (event.currentTarget as HTMLElement).releasePointerCapture(
            event.pointerId,
        );
        const sel = dragSelect;
        dragSelect = null;

        const dx = Math.abs(sel.endX - sel.startX);
        const dy = Math.abs(sel.endY - sel.startY);
        if (dx < 5 || dy < 5) {
            // Treat as a click — clear any existing crop.
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
        if (!dragSelect) {
            return null;
        }
        const left = Math.min(dragSelect.startX, dragSelect.endX);
        const top = Math.min(dragSelect.startY, dragSelect.endY);
        const width = Math.abs(dragSelect.endX - dragSelect.startX);
        const height = Math.abs(dragSelect.endY - dragSelect.startY);
        return `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
    });

    const cropRectStyle = $derived.by((): string | null => {
        if (!crop) {
            return null;
        }
        const display = sourceToDisplay(crop);
        if (!display) {
            return null;
        }
        return `left:${display.left}px;top:${display.top}px;width:${display.width}px;height:${display.height}px`;
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
