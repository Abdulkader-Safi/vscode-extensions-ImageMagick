<script lang="ts">
    import Router, { link, router } from "svelte-spa-router";
    import NotificationPage from "./pages/NotificationPage.svelte";
    import DirectoryListPage from "./pages/DirectoryListPage.svelte";

    const routes = {
        "/": NotificationPage,
        "/directory": DirectoryListPage,
    };

    const navItems = [
        { path: "/", label: "Notifications" },
        { path: "/directory", label: "Directory" },
    ];
</script>

<div class="flex h-full text-vscode-fg bg-vscode-bg">
    <aside
        class="flex flex-col w-56 border-r bg-vscode-sidebar-bg text-vscode-sidebar-fg border-vscode-sidebar-border"
    >
        <div
            class="px-4 py-2 text-xs font-semibold tracking-wide uppercase bg-vscode-section-bg text-vscode-section-fg"
        >
            Svelte Starter
        </div>
        <nav class="flex flex-col flex-1 py-1 overflow-y-auto">
            {#each navItems as item (item.path)}
                <a
                    use:link
                    href={item.path}
                    class="px-4 py-1.5 text-sm hover:bg-vscode-list-hover {router.location ===
                    item.path
                        ? 'bg-vscode-list-active-bg text-vscode-list-active-fg'
                        : ''}"
                >
                    {item.label}
                </a>
            {/each}
        </nav>
    </aside>

    <main class="flex-1 overflow-y-auto">
        <Router {routes} />
    </main>
</div>
