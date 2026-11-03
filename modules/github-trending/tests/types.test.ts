import assert from "node:assert/strict";
import { test } from "node:test";
import { describeOf } from "../backend/types.ts";

test("the Chinese description is shown when there is one", () => {
  assert.equal(describeOf({ description: "an English description", descriptionZh: "一句中文简介" }), "一句中文简介");
});

test("the original is shown when the model has not written one", () => {
  assert.equal(describeOf({ description: "an English description", descriptionZh: null }), "an English description");
});

test("a repository without a description shows nothing", () => {
  assert.equal(describeOf({ description: null, descriptionZh: null }), null);
});