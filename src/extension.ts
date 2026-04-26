import * as vscode from "vscode";
import { SvelteWebviewProvider } from "./WebviewProvider";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("svelte-starter.openSvelteView", () => {
      SvelteWebviewProvider.createOrShow(context.extensionUri);
    })
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
