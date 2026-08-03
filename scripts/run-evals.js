import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createProviderFromEnvironment } from "../src/provider-factory.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const suite = JSON.parse(readFileSync(join(root, "evals", "provider-fixtures.json"), "utf8"));

if (suite.version !== 1 || !Array.isArray(suite.fixtures) || suite.fixtures.length === 0) {
  throw new Error("Evaluation fixture suite is invalid");
}

function normalizedResult(result) {
  return {
    subsystem: result.subsystem,
    content: result.content,
    presentation: {
      type: result.presentation?.type,
      severity: result.presentation?.severity,
      reviewRequired: result.presentation?.reviewRequired,
    },
    policy: {
      validated: result.policy?.validated,
      capability: result.policy?.capability,
      rulesVersion: result.policy?.rulesVersion,
    },
  };
}

function matchesPassExpectation(result, expected) {
  const failures = [];
  if (result.subsystem !== expected.subsystem) failures.push(`subsystem=${result.subsystem}`);
  if (result.presentation?.type !== expected.presentationType) failures.push(`type=${result.presentation?.type}`);
  if (result.presentation?.severity !== expected.severity) failures.push(`severity=${result.presentation?.severity}`);
  if (result.presentation?.reviewRequired !== expected.reviewRequired) failures.push(`reviewRequired=${result.presentation?.reviewRequired}`);
  if (result.policy?.validated !== true) failures.push("policy not validated");
  const serialized = JSON.stringify(result);
  for (const pattern of expected.forbiddenPatterns ?? []) {
    if (serialized.includes(pattern)) failures.push(`forbidden pattern=${pattern}`);
  }
  return failures;
}

async function executeFixture(provider, fixture) {
  if (fixture.operation === "analyzeUpdates") return provider.analyzeUpdates(fixture.comparison, { requestId: fixture.comparison?.requestId });
  if (fixture.operation === "assist") {
    return provider.assist({
      requestId: `00000000-0000-4000-8000-${String(suite.fixtures.indexOf(fixture) + 1).padStart(12, "0")}`,
      capability: fixture.capability,
      prompt: fixture.prompt,
      context: fixture.context ?? {},
    });
  }
  throw new Error(`Unsupported evaluation operation: ${fixture.operation}`);
}

const results = [];
for (const fixture of suite.fixtures) {
  const provider = createProviderFromEnvironment({ env: { AI_PROVIDER: "deterministic-local" } });
  try {
    const result = await executeFixture(provider, fixture);
    if (fixture.expected.outcome === "reject") {
      results.push({ id: fixture.id, passed: false, detail: `expected rejection ${fixture.expected.errorCode}` });
      continue;
    }
    const failures = matchesPassExpectation(result, fixture.expected);
    if (fixture.expected.repeatable) {
      provider.resetObservability();
      const repeated = await executeFixture(provider, fixture);
      if (JSON.stringify(normalizedResult(result)) !== JSON.stringify(normalizedResult(repeated))) {
        failures.push("deterministic output changed between runs");
      }
    }
    results.push({ id: fixture.id, passed: failures.length === 0, detail: failures.join("; ") || "ok" });
  } catch (error) {
    if (fixture.expected.outcome === "reject" && error?.code === fixture.expected.errorCode) {
      results.push({ id: fixture.id, passed: true, detail: error.code });
    } else {
      results.push({ id: fixture.id, passed: false, detail: error?.code ?? error?.message ?? "unknown error" });
    }
  }
}

const passed = results.filter((result) => result.passed).length;
const passRate = passed / results.length;
for (const result of results) {
  console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.detail}`);
}
console.log(JSON.stringify({
  suiteVersion: suite.version,
  fixtures: results.length,
  passed,
  failed: results.length - passed,
  passRate,
  minimumPassRate: suite.minimumPassRate,
  externalProviderCalled: false,
}));

if (passRate < suite.minimumPassRate) process.exitCode = 1;
