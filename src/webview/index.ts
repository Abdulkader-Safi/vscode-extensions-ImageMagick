import { mount } from "svelte";
import EditorPage from "./pages/EditorPage.svelte";

const target = document.getElementById("root");
if (!target) {
  throw new Error("Webview root element #root not found");
}

const app = mount(EditorPage, { target });

export default app;
