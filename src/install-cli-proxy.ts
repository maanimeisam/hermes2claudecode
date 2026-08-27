import Debug from "debug";
import got from "got";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { args } from "./args.ts";
import { CONFIG_PATH } from "./config-yaml.ts";
import { TOKENS_PATH } from "./config.ts";

const log = Debug("app:install");

const VERSION = "7.2.142";
const RELEASE_BASE = `https://github.com/router-for-me/CLIProxyAPI/releases/download/v${VERSION}`;
const TOOLS_DIR = path.join(import.meta.dirname, "..", "tools");

function pickAsset(): string {
  const p = os.platform();
  const a = os.arch();
  let platform: string;
  let ext: "tar.gz" | "zip";
  switch (p) {
    case "win32":
      platform = "windows";
      ext = "zip";
      break;
    case "darwin":
      platform = "darwin";
      ext = "tar.gz";
      break;
    case "freebsd":
      platform = "freebsd";
      ext = "tar.gz";
      break;
    case "linux":
      platform = "linux";
      ext = "tar.gz";
      break;
    default:
      throw new Error(`Unsupported platform: ${p}`);
  }
  let arch: string;
  switch (a) {
    case "x64":
      arch = "amd64";
      break;
    case "arm64":
      arch = "aarch64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${a}`);
  }
  return `CLIProxyAPI_${VERSION}_${platform}_${arch}.${ext}`;
}

async function download(url: string, dest: string): Promise<void> {
  const stream = got.stream(url);
  stream.on("downloadProgress", ({ transferred, total, percent }) => {
    const t = (transferred / 1e6).toFixed(1);
    const totalStr = total ? `/${(total / 1e6).toFixed(1)}` : "";
    const pct = total ? ` (${(percent * 100).toFixed(0)}%)` : "";
    process.stderr.write(`\r⬇️  ${t}MB${totalStr}${pct}`);
  });
  try {
    await pipeline(stream, fs.createWriteStream(dest));
  } finally {
    process.stderr.write("\n");
  }
}

function extract(archivePath: string, destDir: string): void {
  const flag = archivePath.endsWith(".zip") ? "-xf" : "-xzf";
  cp.execFileSync("tar", [flag, archivePath, "-C", destDir], {
    stdio: "inherit",
  });
}

export async function ensureCliProxy(): Promise<void> {
  const asset = pickAsset();
  const url = `${RELEASE_BASE}/${asset}`;
  const archivePath = path.join(TOOLS_DIR, asset);

  // --renew: re-extract from the kept archive, then app.ts re-runs the device flow.
  if (args.renew) {
    if (fs.existsSync(TOKENS_PATH)) {
      fs.rmSync(TOKENS_PATH, { force: true });
      log("--renew: cleared stored token, will re-run device flow");
    }
    renewFromArchive(archivePath);
    return;
  }

  if (
    fs.existsSync(TOOLS_DIR) &&
    fs.readdirSync(TOOLS_DIR).length > 0 &&
    !args.force
  ) {
    log("CLIProxyAPI already present at %s, skipping download", TOOLS_DIR);
    return;
  }

  if (args.force) {
    console.warn(
      `⚠️  --force set: re-downloading archive and overwriting extracted files in ${TOOLS_DIR}`,
    );
  }

  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  // Keep the archive alongside the extracted files (no .tmp- + rm).
  if (!fs.existsSync(archivePath)) {
    console.error(`⬇️  Downloading from ${url}`);
    log("Downloading %s", url);
    await download(url, archivePath);
  } else {
    log("Archive already present, skipping download: %s", archivePath);
  }
  extract(archivePath, TOOLS_DIR);
  log("Installed CLIProxyAPI to %s", TOOLS_DIR);
  createConfig();
}

function renewFromArchive(archivePath: string): void {
  if (!fs.existsSync(archivePath)) {
    console.error(
      "❌ No archive at " +
        archivePath +
        " to renew from — run once without --renew to fetch it.",
    );
    process.exit(1);
  }
  const keep = new Set([path.basename(archivePath)]);
  for (const name of fs.readdirSync(TOOLS_DIR)) {
    if (keep.has(name)) continue;
    fs.rmSync(path.join(TOOLS_DIR, name), { recursive: true, force: true });
  }
  extract(archivePath, TOOLS_DIR);
  log("Renewed CLIProxyAPI from %s", archivePath);
  createConfig();
  args.renew = false;
}

// ponytail: only seeds when live config absent — never clobbers an edited one
function createConfig(): void {
  const example = path.join(TOOLS_DIR, "config.example.yaml");
  if (!fs.existsSync(example)) {
    console.error(`❌ Missing template: ${example}`);
    process.exit(1);
  }
  if (fs.existsSync(CONFIG_PATH)) return;
  fs.copyFileSync(example, CONFIG_PATH);
  log("Seeded %s from %s", CONFIG_PATH, example);
}
