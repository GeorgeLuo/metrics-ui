import { createRoot } from "react-dom/client";
import App from "./App";
import { installBrowserExtensionErrorOverlayFilter } from "./lib/browser-extension-noise";
import "katex/dist/katex.min.css";
import "./index.css";

installBrowserExtensionErrorOverlayFilter();

createRoot(document.getElementById("root")!).render(<App />);
