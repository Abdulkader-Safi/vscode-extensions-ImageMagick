# Svelte Starter - VSCode Extension

A VSCode extension template built with Svelte 5, TailwindCSS, and svelte-spa-router for building modern webview-based extensions.

## Features

This extension includes two example pages demonstrating VSCode webview API integration:

1. **Notification Page** - Send messages from the webview to VSCode to show notifications
2. **Directory Listing Page** - Request data from VSCode and display it in the Svelte UI

## Project Structure

```
.
├── src/
│   ├── extension.ts              # Extension entry point
│   ├── WebviewProvider.ts        # Webview panel provider
│   └── webview/
│       ├── index.ts              # Svelte app entry point (mount)
│       ├── index.css             # TailwindCSS imports
│       ├── App.svelte            # Main app with routing
│       ├── global.d.ts           # Type declarations (svelte, css)
│       ├── vscode.d.ts           # acquireVsCodeApi() type
│       ├── vscodeApi.ts          # VS Code API wrapper
│       └── pages/
│           ├── NotificationPage.svelte
│           └── DirectoryListPage.svelte
├── dist/                         # Build output
├── esbuild.js                    # Build configuration
├── svelte.config.js              # Svelte tooling config
├── tailwind.config.js            # TailwindCSS configuration
└── postcss.config.js             # PostCSS configuration
```

## Development

### Prerequisites

- Node.js and npm
- VSCode

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the extension:

   ```bash
   npm run compile
   ```

3. Watch for changes:

   ```bash
   npm run watch
   ```

### Running the Extension

1. Press `F5` in VSCode to open a new Extension Development Host window
2. Open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux)
3. Run the command: **Open Svelte View**
4. The Svelte webview will open in a new panel in the main editor area

## Examples

### Notification Button

Navigate to the "Notification" page and click the button to send a notification to VSCode. This demonstrates:

- Message passing from webview to extension
- Using `vscode.window.showInformationMessage()`

### Directory Listing

Navigate to the "Directory" page to see the contents of your workspace. This demonstrates:

- Requesting data from the extension
- Receiving and displaying data in Svelte
- Using VSCode's file system API

## Technology Stack

- **Svelte 5** - UI framework (runes syntax: `$state`, `$effect`, `$props`)
- **svelte-spa-router** - Hash-based client-side routing (ideal for webviews)
- **TailwindCSS v4** - Utility-first CSS framework
- **TypeScript** - Type safety
- **esbuild** + **esbuild-svelte** - Fast bundler with Svelte support
- **PostCSS** - CSS processing

## Build Scripts

- `npm run compile` - Build the extension
- `npm run watch` - Watch mode for development
- `npm run check-types` - Type checking (tsc + svelte-check)
- `npm run lint` - Lint the code
- `npm test` - Run tests

## VSCode API Communication

The extension uses the VSCode webview messaging API:

**From Webview to Extension:**

```typescript
vscode.postMessage({
  type: "showNotification",
  message: "Hello from Svelte!",
});
```

**From Extension to Webview:**

```typescript
panel.webview.postMessage({
  type: "directoryContents",
  data: { contents: [...] },
});
```

## Customization

### Adding New Pages

1. Create a new `.svelte` component in `src/webview/pages/`
2. Add a route in `src/webview/App.svelte` (update the `routes` object)
3. Add a navigation link in the nav bar using `use:link`

### Styling

The extension uses TailwindCSS v4. All Tailwind utilities are available. The theme uses a dark color scheme optimized for VSCode.

## Commands

- `Open Svelte View` - Opens the Svelte webview panel
- `Hello World` - Shows a simple notification (example command)

## License

MIT
