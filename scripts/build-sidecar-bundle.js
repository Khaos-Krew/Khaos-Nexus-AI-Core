import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_NAME, SERVICE_VERSION } from "../src/constants.js";
import { SIDECAR_CONTRACT_VERSION } from "../src/sidecar-contract.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(root, "dist", "sidecar");
const bundleName = `${SERVICE_NAME}-${SERVICE_VERSION}`;
const bundleDirectory = join(outputRoot, bundleName);

async function copyFile(sourcePath, destinationPath) {
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { force: true, preserveTimestamps: false });
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function digest(path) {
  const value = await readFile(path);
  return { sha256: createHash("sha256").update(value).digest("hex"), bytes: value.length };
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(bundleDirectory, { recursive: true });

const sourceDirectory = join(root, "src");
for (const entry of (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter((value) => value.isFile() && value.name.endsWith(".js"))
  .sort((left, right) => left.name.localeCompare(right.name))) {
  await copyFile(join(sourceDirectory, entry.name), join(bundleDirectory, "src", entry.name));
}

const requiredFiles = [
  ["contracts/nexus-ai-core-v1.schema.json", "contracts/nexus-ai-core-v1.schema.json"],
  ["contracts/service-manifest.json", "contracts/service-manifest.json"],
  ["contracts/sidecar-manifest.json", "contracts/sidecar-manifest.json"],
  ["README.md", "README.md"],
  ["SECURITY.md", "SECURITY.md"],
  ["docs/CLIENT_INTEGRATION.md", "docs/CLIENT_INTEGRATION.md"],
  ["docs/SIDECAR.md", "docs/SIDECAR.md"],
];
for (const [source, destination] of requiredFiles) {
  await copyFile(join(root, source), join(bundleDirectory, destination));
}

const packageMetadata = {
  name: SERVICE_NAME,
  version: SERVICE_VERSION,
  private: true,
  type: "module",
  engines: { node: ">=22" },
  main: "./src/sidecar.js",
  exports: {
    ".": "./src/sidecar.js",
    "./client": "./src/client.js",
    "./contract": "./src/service-contract.js",
    "./sidecar": "./src/sidecar.js",
    "./sidecar-contract": "./src/sidecar-contract.js",
    "./manifest": "./contracts/service-manifest.json",
    "./sidecar-manifest": "./contracts/sidecar-manifest.json"
  },
  scripts: { start: "node src/sidecar.js" }
};
await writeFile(join(bundleDirectory, "package.json"), `${JSON.stringify(packageMetadata, null, 2)}\n`, "utf8");

const runtimeFiles = (await listFiles(join(bundleDirectory, "src")))
  .map((path) => relative(bundleDirectory, path).replaceAll("\\", "/"));
const bundleMetadata = {
  formatVersion: 1,
  bundleName,
  service: SERVICE_NAME,
  serviceVersion: SERVICE_VERSION,
  sidecarContractVersion: SIDECAR_CONTRACT_VERSION,
  entrypoint: "src/sidecar.js",
  runtime: "node>=22",
  runtimeDependencies: 0,
  publicationAutomatic: false,
  runtimeFiles,
};
await writeFile(join(bundleDirectory, "bundle-metadata.json"), `${JSON.stringify(bundleMetadata, null, 2)}\n`, "utf8");

const integrity = {};
for (const path of await listFiles(bundleDirectory)) {
  const name = relative(bundleDirectory, path).replaceAll("\\", "/");
  if (name === "integrity.json") continue;
  integrity[name] = await digest(path);
}
await writeFile(join(bundleDirectory, "integrity.json"), `${JSON.stringify({ algorithm: "sha256", files: integrity }, null, 2)}\n`, "utf8");

const outputStat = await stat(bundleDirectory);
if (!outputStat.isDirectory()) throw new Error("Sidecar bundle output was not created");
console.log(JSON.stringify({ bundleDirectory, bundleName, serviceVersion: SERVICE_VERSION, files: Object.keys(integrity).length, verified: false }));
