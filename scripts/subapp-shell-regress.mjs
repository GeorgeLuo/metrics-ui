import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function read(filePath) {
  return fs.readFileSync(filePath, "utf-8");
}

function requireRegex(source, regex, message) {
  assert.match(source, regex, message);
}

function main() {
  const homePath = path.join(repoRoot, "client", "src", "pages", "home.tsx");
  const sidebarHeaderPath = path.join(
    repoRoot,
    "client",
    "src",
    "components",
    "home",
    "sidebar-subapp-header.tsx",
  );
  const storagePath = path.join(repoRoot, "client", "src", "lib", "dashboard", "storage.ts");
  const floatingFramePath = path.join(repoRoot, "client", "src", "components", "floating-frame.tsx");

  const home = read(homePath);
  const sidebarHeader = fs.existsSync(sidebarHeaderPath) ? read(sidebarHeaderPath) : "";
  const headerSource = `${home}\n${sidebarHeader}`;
  const storage = read(storagePath);
  const floatingFrame = read(floatingFramePath);

  // Sub-app selector contract.
  requireRegex(
    headerSource,
    /data-testid="button-sidebar-app-menu"/,
    "sidebar app menu trigger is missing",
  );
  requireRegex(
    headerSource,
    /data-testid="menuitem-sidebar-app-metrics"/,
    "sidebar app metrics menu item is missing",
  );
  requireRegex(
    headerSource,
    /data-testid="menuitem-sidebar-app-texts"/,
    "sidebar app texts menu item is missing",
  );
  requireRegex(
    headerSource,
    /data-testid="button-toggle-sidebar-mode"/,
    "submenu toggle trigger is missing",
  );

  // Sidebar content split contract.
  requireRegex(
    home,
    /isMetricsSidebarApp\(sidebarApp\)\s*\?\s*\(/,
    "sidebar app branch condition is missing",
  );
  requireRegex(
    home,
    /<SidebarSetupPane/s,
    "metrics sidebar setup pane render is missing",
  );
  requireRegex(
    home,
    /<SidebarDerivationsPane/s,
    "metrics sidebar derivations pane render is missing",
  );
  requireRegex(
    home,
    /<SidebarTextsPane\s*\/>/s,
    "texts sidebar pane render is missing",
  );

  // Main content split contract.
  requireRegex(
    home,
    /\{isMetricsSidebarApp\(sidebarApp\)\s*\?\s*\(\s*<MetricsMainPanel/s,
    "metrics main panel conditional branch is missing",
  );
  requireRegex(
    home,
    /:\s*\(\s*<TextsMainPanel\s*\/>\s*\)\s*\}/s,
    "texts main panel branch is missing",
  );

  // Persistence contract for active sub-app.
  requireRegex(
    storage,
    /sidebarApp:\s*"metrics-ui-sidebar-app"/,
    "sidebar app storage key is missing",
  );

  // Drag/drop reliability contract for floating frame.
  requireRegex(
    floatingFrame,
    /onPointerDown=\{handleDragStart\}/,
    "floating frame should start drag on pointer down",
  );
  requireRegex(
    floatingFrame,
    /setPointerCapture\(/,
    "floating frame should capture pointer during drag",
  );
  requireRegex(
    floatingFrame,
    /pointercancel/,
    "floating frame should handle pointer cancel to avoid stuck drag",
  );

  console.log("[subapp-shell-regress] PASS");
}

try {
  main();
} catch (error) {
  console.error("[subapp-shell-regress] FAIL:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
