import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import {
  configEntryState,
  listConfigEntries,
  registerConfigEntries,
  resetConfigValue,
  runtimeBool,
  setConfigValue,
  validateConfigValue,
} from "@aihot/backend/runtime-config";
import { scheduleDueSources } from "@aihot/backend/sources/collect";
import { tag } from "./setup.ts";

const T = tag();
const key = "test.runtime." + T;
const boolEnv = "RUNTIME_CONFIG_TEST_" + T;

registerConfigEntries([
  { key, label: "测试开关", group: "测试", type: "bool", env: boolEnv, default: false },
  { key: key + ".int", label: "测试数字", group: "测试", type: "int", default: 3 },
  { key: key + ".enum", label: "测试枚举", group: "测试", type: "enum", options: ["a", "b"], default: "a" },
  { key: key + ".secret", label: "测试密钥", group: "测试", type: "string", secret: true },
]);

after(async () => {
  await closeDb();
});

const entry = (name: string) => listConfigEntries().find((e) => e.key === name)!;

test("the admin value beats the environment, and the default is the last resort", async () => {
  process.env[boolEnv] = "true";
  const e = entry(key);
  assert.equal(configEntryState(e).source, "env");
  assert.equal(configEntryState(e).value, true);
  await setConfigValue(key, "false", "测试", "test");
  const afterAdmin = configEntryState(e);
  assert.equal(afterAdmin.source, "admin");
  assert.equal(afterAdmin.value, false);
  delete process.env[boolEnv];
  await resetConfigValue(key, "测试", "test");
  assert.equal(configEntryState(e).source, "default");
  assert.equal(configEntryState(e).value, false);
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM settings WHERE key = ${"config." + key}`;
  assert.equal(rows[0]!.n, 0);
});

test("a value is checked against the type of the entry", () => {
  assert.throws(() => validateConfigValue(entry(key), "maybe"));
  assert.equal(validateConfigValue(entry(key), true), "true");
  assert.throws(() => validateConfigValue(entry(key + ".int"), "1.5"));
  assert.equal(validateConfigValue(entry(key + ".int"), "12"), "12");
  assert.throws(() => validateConfigValue(entry(key + ".enum"), "c"));
  assert.equal(validateConfigValue(entry(key + ".enum"), "b"), "b");
});

test("a secret never shows its value", () => {
  const state = configEntryState(entry(key + ".secret"));
  assert.equal(state.value, null);
  assert.equal(state.hasValue, false);
});

test("the engine entries are registered", () => {
  const collect = entry("collect.enabled");
  assert.equal(collect.env, "COLLECT_ENABLED");
  assert.equal(collect.type, "bool");
});

test("the collect switch stops the scheduler without a restart", async () => {
  await setConfigValue("collect.enabled", "false", "测试", "test");
  assert.equal(runtimeBool("collect.enabled"), false);
  const due = await scheduleDueSources();
  assert.equal(due.enqueued, 0);
  assert.equal(due.shards, 0);
  await setConfigValue("collect.enabled", "true", "测试", "test");
  assert.equal(runtimeBool("collect.enabled"), true);
  await resetConfigValue("collect.enabled", "测试", "test");
});
