import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_NAME, SERVICE_VERSION } from "../src/constants.js";
import { SIDECAR_CONTRACT, SIDECAR_CONTRACT_VERSION } from "../src/sidecar-contract.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleName = `${SERVICE_NAME}-${SERVICE_VERSION}`;
const bundleDirectory = join(root, "dist", "sidecar", bundleName);
const forbiddenPattern = /(^|\/)(?:\.env(?:\.|$)|\.git|tests?|logs?|monitor-state|node_modules)(?:\/|$)|\.(?:log|tmp)$/i;

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(relative(bundleDirectory, fullPath).replaceAll("\\", "/"));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function assert(condition, message) {
  if (!condition) throw new Error(`Sidecar verification failed: ${message}`);
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const output = await stat(bundleDirectory).catch(() => null);
assert(output?.isDirectory(), "bundle directory is missing");

const integrity = await json(join(bundleDirectory, "integrity.json"));
assert(integrity.algorithm === "sha256", "integrity algorithm is not sha256");
assert(integrity.files && typeof integrity.files === "object", "integrity file list is missing");

const actualFiles = await listFiles(bundleDirectory);
const expectedFiles = [...Object.keys(integrity.files), "integrity.json"].sort((left, right) => left.localeCompare(right));
assert(JSON.stringify(actualFiles) === JSON.stringify(expectedFiles), "bundle has missing or unexpected files");

for (const name of actualFiles) {
  assert(!forbiddenPattern.test(name), `forbidden bundle path ${name}`);
}
for (const [name, expected] of Object.entries(integrity.files)) {
  const bytes = await readFile(join(bundleDirectory, name));
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert(digest === expected.sha256, `hash mismatch for ${name}`);
  assert(bytes.length === expected.bytes, `size mismatch for ${name}`);
}

const packageMetadata = await json(join(bundleDirectory, "package.json"));
const serviceManifest = await json(join(bundleDirectory, "contracts", "service-manifest.json"));
const sidecarManifest = await json(join(bundleDirectory, "contracts", "sidecar-manifest.json"));
const bundleMetadata = await json(join(bundleDirectory, "bundle-metadata.json"));

assert(packageMetadata.name === SERVICE_NAME, "package name differs");
assert(packageMetadata.version === SERVICE_VERSION, "package version differs");
assert(packageMetadata.main === "./src/sidecar.js", "package entrypoint differs");
assert(serviceManifest.serviceVersion === SERVICE_VERSION, "service manifest version differs");
assert(sidecarManifest.serviceVersion === SERVICE_VERSION, "sidecar manifest version differs");
assert(sidecarManifest.sidecarContractVersion === SIDECAR_CONTRACT_VERSION, "sidecar contract version differs");
assert(JSON.stringify(sidecarManifest) === JSON.stringify(SIDECAR_CONTRACT), "static sidecar manifest differs from source contract");
assert(bundleMetadata.serviceVersion === SERVICE_VERSION, "bundle metadata version differs");
assert(bundleMetadata.runtimeDependencies === 0, "runtime dependency count differs");
assert(bundleMetadata.publicationAutomatic === false, "automatic publication must remain disabled");
assert(actualFiles.includes("src/client.js"), "hardened client is missing");
assert(actualFiles.includes("src/sidecar.js"), "sidecar entrypoint is missing");
assert(actualFiles.includes("src/service-contract.js"), "service contract source is missing");

console.log(JSON.stringify({
  bundleDirectory,
  bundleName,
  serviceVersion: SERVICE_VERSION,
  sidecarContractVersion: SIDECAR_CONTRACT_VERSION,
  files: actualFiles.length,
  runtimeDependencies: 0,
  externalNetworkCalled: false,
  verified: true,
}));
