import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("root");
if (!target) {
  throw new Error("Webview root element #root not found");
}

const app = mount(App, { target });

export default app;
