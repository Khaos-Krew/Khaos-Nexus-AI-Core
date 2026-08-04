import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NexusAiCoreClient, nexusAiCoreClientMethods } from "../src/client.js";
import { API_VERSION, CAPABILITIES, SERVICE_VERSION, TARGET_SERVICE } from "../src/constants.js";
import { CONTRACT_SCHEMA_ID, ENDPOINT_REGISTRY, SERVICE_CONTRACT } from "../src/service-contract.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "contracts", "service-manifest.json"), "utf8"));
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
assert(manifest.apiVersion === API_VERSION, "API version differs");
assert(manifest.serviceVersion === SERVICE_VERSION, "service version differs");
assert(manifest.targetService === TARGET_SERVICE, "target service differs");
assert(packageJson.version === SERVICE_VERSION, "package version differs");
assert(packageLock.version === SERVICE_VERSION, "package-lock version differs");
assert(packageLock.packages?.[""]?.version === SERVICE_VERSION, "package-lock root package version differs");
assert(JSON.stringify(manifest.capabilities) === JSON.stringify(CAPABILITIES), "capability order or content differs");
assert(manifest.capabilities.every((capability) => capability.startsWith("nexus.") && !capability.startsWith("dnd.")), "invalid capability namespace");
assert(schema.$id === CONTRACT_SCHEMA_ID, "schema ID differs");

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

console.log(JSON.stringify({
  contractVersion: manifest.contractVersion,
  serviceVersion: manifest.serviceVersion,
  apiVersion: manifest.apiVersion,
  endpoints: ENDPOINT_REGISTRY.length,
  capabilities: CAPABILITIES.length,
  schemaDefinitions: requiredDefinitions.length,
  clientMethods: Object.keys(nexusAiCoreClientMethods).length,
  externalNetworkCalled: false,
  verified: true,
}));
