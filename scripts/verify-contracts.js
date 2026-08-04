import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NexusAiCoreClient, nexusAiCoreClientMethods } from "../src/client.js";
import { API_VERSION, CAPABILITIES, SERVICE_VERSION, TARGET_SERVICE } from "../src/constants.js";
import { CONTRACT_SCHEMA_ID, ENDPOINT_REGISTRY, SERVICE_CONTRACT } from "../src/service-contract.js";
import { SIDECAR_CONTRACT } from "../src/sidecar-contract.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "contracts", "service-manifest.json"), "utf8"));
const sidecarManifest = JSON.parse(readFileSync(join(root, "contracts", "sidecar-manifest.json"), "utf8"));
const schema = JSON.parse(readFileSync(join(root, "contracts", "nexus-ai-core-v1.schema.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function assert(condition, message) {
  if (!condition) throw new Error(`Contract verification failed: ${message}`);
}

assert(JSON.stringify(stable(manifest)) === JSON.stringify(stable(SERVICE_CONTRACT)), "static manifest differs from source contract");
assert(JSON.stringify(stable(sidecarManifest)) === JSON.stringify(stable(SIDECAR_CONTRACT)), "static sidecar manifest differs from source sidecar contract");
assert(manifest.apiVersion === API_VERSION, "API version differs");
assert(manifest.serviceVersion === SERVICE_VERSION, "service version differs");
assert(sidecarManifest.serviceVersion === SERVICE_VERSION, "sidecar service version differs");
assert(manifest.targetService === TARGET_SERVICE, "target service differs");
assert(packageJson.version === SERVICE_VERSION, "package version differs");
assert(packageLock.version === SERVICE_VERSION, "package-lock version differs");
assert(packageLock.packages?.[""]?.version === SERVICE_VERSION, "package-lock root package version differs");
assert(JSON.stringify(manifest.capabilities) === JSON.stringify(CAPABILITIES), "capability order or content differs");
assert(manifest.capabilities.every((capability) => capability.startsWith("nexus.") && !capability.startsWith("dnd.")), "invalid capability namespace");
assert(schema.$id === CONTRACT_SCHEMA_ID, "schema ID differs");

const requiredExports = {
  "./client": "./src/client.js",
  "./contract": "./src/service-contract.js",
  "./manifest": "./contracts/service-manifest.json",
  "./sidecar": "./src/sidecar.js",
  "./sidecar-contract": "./src/sidecar-contract.js",
  "./sidecar-manifest": "./contracts/sidecar-manifest.json",
};
for (const [key, value] of Object.entries(requiredExports)) {
  assert(packageJson.exports?.[key] === value, `package export differs for ${key}`);
}
assert(packageJson.bin?.["khaos-nexus-ai-core-sidecar"] === "./src/sidecar.js", "sidecar binary entry differs");
assert(packageJson.scripts?.contracts === "node scripts/verify-contracts.js", "contract verification script differs");
assert(packageJson.scripts?.["bundle:sidecar"] === "node scripts/build-sidecar-bundle.js", "sidecar bundle script differs");
assert(packageJson.scripts?.["verify:sidecar"] === "node scripts/verify-sidecar-bundle.js", "sidecar verification script differs");

const requiredDefinitions = [
  "requestEnvelope", "neutralResponse", "providerStatus", "monitorPollResult",
  "updateEvaluation", "updateDigest", "maintenanceProposal", "errorResponse",
];
for (const definition of requiredDefinitions) {
  assert(Boolean(schema.$defs?.[definition]), `missing schema definition ${definition}`);
  assert(manifest.schemas[definition] === `${CONTRACT_SCHEMA_ID}#/$defs/${definition}`, `schema reference differs for ${definition}`);
}

const endpointKeys = new Set();
const methodPaths = new Set();
for (const endpoint of ENDPOINT_REGISTRY) {
  assert(!endpointKeys.has(endpoint.key), `duplicate endpoint key ${endpoint.key}`);
  endpointKeys.add(endpoint.key);
  const methodPath = `${endpoint.method} ${endpoint.path}`;
  assert(!methodPaths.has(methodPath), `duplicate endpoint ${methodPath}`);
  methodPaths.add(methodPath);
  assert(endpoint.path.startsWith("/"), `endpoint path is not absolute: ${endpoint.key}`);
  assert(["GET", "POST"].includes(endpoint.method), `endpoint method is unsupported: ${endpoint.key}`);
  assert(nexusAiCoreClientMethods[endpoint.clientMethod] === endpoint.key, `client registry differs for ${endpoint.clientMethod}`);
  assert(typeof NexusAiCoreClient.prototype[endpoint.clientMethod] === "function", `client method missing: ${endpoint.clientMethod}`);
  if (endpoint.capability && endpoint.capability !== "dynamic-assist") {
    assert(CAPABILITIES.includes(endpoint.capability), `endpoint capability is not advertised: ${endpoint.key}`);
  }
}

assert(manifest.directExecution === false, "direct execution must remain disabled");
assert(manifest.directDiscordConnection === false, "direct Discord connection must remain disabled");
assert(manifest.directServiceForwarding === false, "direct service forwarding must remain disabled");
assert(manifest.dndIsolation?.directCallsAllowed === false, "D&D direct calls must remain disabled");
assert(sidecarManifest.transport?.authenticationRequired === true, "sidecar authentication must remain required");
assert(sidecarManifest.transport?.allowedHosts?.every((host) => ["127.0.0.1", "::1"].includes(host)), "sidecar host boundary differs");
assert(sidecarManifest.supervision?.httpShutdownSupported === false, "HTTP shutdown must remain disabled");
assert(sidecarManifest.boundaries?.directDndCallsAllowed === false, "sidecar D&D direct calls must remain disabled");
assert(sidecarManifest.boundaries?.githubWebhooksEnabled === false, "sidecar GitHub webhooks must remain disabled");

console.log(JSON.stringify({
  contractVersion: manifest.contractVersion,
  sidecarContractVersion: sidecarManifest.sidecarContractVersion,
  serviceVersion: manifest.serviceVersion,
  apiVersion: manifest.apiVersion,
  endpoints: ENDPOINT_REGISTRY.length,
  capabilities: CAPABILITIES.length,
  schemaDefinitions: requiredDefinitions.length,
  clientMethods: Object.keys(nexusAiCoreClientMethods).length,
  packageExports: Object.keys(requiredExports).length,
  externalNetworkCalled: false,
  verified: true,
}));
