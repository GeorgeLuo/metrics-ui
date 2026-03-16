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
  const equationsPanelPath = path.join(
    repoRoot,
    "client",
    "src",
    "components",
    "home",
    "equations-main-panel.tsx",
  );
  const storagePath = path.join(repoRoot, "client", "src", "lib", "dashboard", "storage.ts");
  const floatingFramePath = path.join(repoRoot, "client", "src", "components", "floating-frame.tsx");

  const home = read(homePath);
  const sidebarHeader = fs.existsSync(sidebarHeaderPath) ? read(sidebarHeaderPath) : "";
  const headerSource = `${home}\n${sidebarHeader}`;
  const storage = read(storagePath);
  const floatingFrame = read(floatingFramePath);
  const equationsPanel = read(equationsPanelPath);

  // Sidebar header toggle contract.
  requireRegex(
    headerSource,
    /data-testid="button-toggle-sidebar-app"/,
    "sub-app selector trigger is missing",
  );
  requireRegex(
    headerSource,
    /data-testid="button-toggle-sidebar-mode"/,
    "submenu toggle trigger is missing",
  );

  // Sidebar content contract.
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

  // Main content contract.
  requireRegex(
    home,
    /<MetricsMainPanel/s,
    "metrics main panel render is missing",
  );
  requireRegex(
    home,
    /<EquationsMainPanel/s,
    "equations main panel render is missing",
  );
  requireRegex(
    home,
    /<SidebarEquationsPane/s,
    "equations sidebar pane render is missing",
  );
  requireRegex(
    equationsPanel,
    /<FrameGrid/s,
    "equations panel should be rendered through FrameGrid",
  );
  requireRegex(
    equationsPanel,
    /<FrameGrid\.Item/s,
    "equations panel should use explicit FrameGrid item placements",
  );

  // Storage should persist sub-app route and should not include Texts-era fields.
  requireRegex(
    storage,
    /metrics-ui-sidebar-app/,
    "sidebar app storage key is missing",
  );
  assert.doesNotMatch(
    storage,
    /textsSelectedSourceId/,
    "texts-era sidebar storage keys should be removed",
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
