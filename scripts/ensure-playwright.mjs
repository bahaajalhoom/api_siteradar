import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const executablePath = chromium.executablePath();

if (!existsSync(executablePath)) {
  console.log(`Playwright Chromium is missing at ${executablePath}. Installing it now.`);
  const cliPath = fileURLToPath(
    new URL("../node_modules/playwright/cli.js", import.meta.url),
  );
  const result = spawnSync(process.execPath, [cliPath, "install", "chromium"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.platform === "linux") {
  const dependencies = spawnSync("ldd", [chromium.executablePath()], { encoding: "utf8" });
  if (dependencies.error || dependencies.status !== 0)
    throw new Error("Cannot inspect Chromium system libraries: install ldd and Playwright system dependencies in the container image.");
  if (dependencies.stdout.includes("not found")) {
    console.log("Chromium system libraries are missing. Installing Playwright dependencies.");
    const cliPath = fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url));
    const result = spawnSync(process.execPath, [cliPath, "install-deps", "chromium"], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log(`Playwright Chromium ready: ${chromium.executablePath()}`);
