import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoForbiddenFields,
  constantTimeEqual,
  sanitizeDiscordText,
  stableHash,
} from "../src/security.js";

test("protected credential fields are rejected recursively", () => {
  assert.throws(
    () => assertNoForbiddenFields({ context: { discordToken: "secret" } }),
    (error) => error.code === "PROTECTED_FIELD_REJECTED",
  );
});

test("Discord broadcast mentions and raw mentions are neutralized", () => {
  const text = sanitizeDiscordText("@everyone @here <@1234> Bearer abcdefghijklmnop");
  assert.equal(text.includes("@everyone"), false);
  assert.equal(text.includes("@here"), false);
  assert.equal(text.includes("<@1234>"), false);
  assert.match(text, /\[REDACTED\]/);
});

test("constant-time token comparison and stable hashes work", () => {
  assert.equal(constantTimeEqual("same", "same"), true);
  assert.equal(constantTimeEqual("same", "different"), false);
  assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
});
