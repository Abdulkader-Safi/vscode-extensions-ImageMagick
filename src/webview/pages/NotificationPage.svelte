<script lang="ts">
    import { vscode } from "../vscodeApi";

    let message = $state("Hello from Svelte!");

    function handleSendNotification() {
        vscode.postMessage({
            type: "showNotification",
            message,
        });
    }
</script>

<div class="max-w-2xl p-6">
    <header class="mb-6">
        <h1 class="mb-1 text-xl font-semibold">Notifications</h1>
        <p class="text-sm text-vscode-description">
            Send a message from the webview to VS Code as an information
            notification.
        </p>
    </header>

    <div class="space-y-4">
        <div>
            <label for="message" class="block mb-1 text-xs font-medium">
                Message
            </label>
            <input
                id="message"
                type="text"
                bind:value={message}
                placeholder="Enter your message..."
                class="w-full px-2 py-1 text-sm border rounded-sm outline-none bg-vscode-input-bg text-vscode-input-fg border-vscode-input-border focus:border-vscode-focus placeholder:text-vscode-input-placeholder"
            />
        </div>

        <button
            type="button"
            onclick={handleSendNotification}
            class="px-3 py-1 text-sm rounded-sm bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover focus:outline-2 focus:outline-vscode-focus"
        >
            Send Notification
        </button>
    </div>

    <section class="p-3 mt-8 text-sm rounded-sm bg-vscode-section-bg">
        <strong class="block mb-1">How it works</strong>
        <p class="text-vscode-description">
            The button posts a
            <code
                class="px-1 py-0.5 rounded font-mono text-xs bg-vscode-code-bg"
                >showNotification</code
            >
            message to the extension host, which calls
            <code
                class="px-1 py-0.5 rounded font-mono text-xs bg-vscode-code-bg"
                >vscode.window.showInformationMessage()</code
            >.
        </p>
    </section>
</div>
