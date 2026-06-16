import assert from "node:assert/strict";
import test from "node:test";
import {
  isBrowserExtensionErrorEvent,
  isBrowserExtensionRuntimeError,
  isKnownBrowserExtensionNoiseMessage,
} from "./browser-extension-noise";

test("browser extension noise filter matches MetaMask content-script warnings", () => {
  assert.equal(
    isKnownBrowserExtensionNoiseMessage(
      'ObjectMultiplex - orphaned data for stream "app-init-liveness"',
    ),
    true,
  );
  assert.equal(
    isKnownBrowserExtensionNoiseMessage(
      "MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 close listeners added.",
    ),
    true,
  );
  assert.equal(
    isKnownBrowserExtensionNoiseMessage("Failed to connect to MetaMask runtime"),
    true,
  );
});

test("browser extension noise filter matches extension script error events", () => {
  const event = {
    type: "error",
    message: "SES_UNCAUGHT_EXCEPTION: null",
    filename: "chrome-extension://extension-id/contentscript.js",
  } as ErrorEvent;

  assert.equal(isBrowserExtensionErrorEvent(event), true);
});

test("browser extension noise filter does not match ordinary app errors", () => {
  const event = {
    type: "error",
    message: "Cannot read properties of undefined",
    filename: "http://localhost:5050/src/pages/home.tsx",
  } as ErrorEvent;

  assert.equal(isBrowserExtensionErrorEvent(event), false);
  assert.equal(isKnownBrowserExtensionNoiseMessage("Visualization runtime error"), false);
});

test("browser extension runtime error filter matches MetaMask overlay errors", () => {
  const error = new Error("Failed to connect to MetaMask");
  error.stack = [
    "Error: Failed to connect to MetaMask",
    "    at Object.connect (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:7:81161)",
  ].join("\n");

  assert.equal(isBrowserExtensionRuntimeError(error), true);
  assert.equal(isBrowserExtensionRuntimeError(new Error("Application runtime error")), false);
});
