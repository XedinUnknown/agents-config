import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "./plan.ts";

test("buildPlan: a later dependency providing the same name wins, and the replacement is reported", () => {
  const plan = buildPlan([
    {
      origin: { repo: "owner/a", ref: "main" },
      skills: [
        { name: "shared", sourcePath: "/a/shared" },
        { name: "only-a", sourcePath: "/a/only-a" },
      ],
      agents: [],
    },
    { origin: { path: "." }, method: "link", skills: [{ name: "shared", sourcePath: "/p/shared" }], agents: [] },
  ]);

  assert.deepEqual(plan.skills, [
    { name: "only-a", sourcePath: "/a/only-a", origin: { repo: "owner/a", ref: "main" } },
    { name: "shared", sourcePath: "/p/shared", origin: { path: "." }, method: "link" },
  ]);
  assert.deepEqual(plan.replacements, [{ kind: "skills", name: "shared", replaced: "owner/a", by: "path:." }]);
});

test("buildPlan keeps skills and agents of the same name independent", () => {
  const plan = buildPlan([
    { origin: { repo: "owner/a", ref: "main" }, skills: [{ name: "x", sourcePath: "/a/s" }], agents: [] },
    { origin: { repo: "owner/b", ref: "main" }, skills: [], agents: [{ name: "x", sourcePath: "/b/x.md" }] },
  ]);
  assert.deepEqual(plan.skills[0]?.origin, { repo: "owner/a", ref: "main" });
  assert.deepEqual(plan.agents[0]?.origin, { repo: "owner/b", ref: "main" });
  assert.deepEqual(plan.replacements, []);
});
