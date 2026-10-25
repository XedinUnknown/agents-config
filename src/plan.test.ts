import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "./plan.ts";

test("buildPlan: a later dependency providing the same name wins, and the replacement is reported", () => {
  const plan = buildPlan([
    {
      repo: "owner/a",
      ref: "main",
      skills: [
        { name: "shared", sourcePath: "/a/shared" },
        { name: "only-a", sourcePath: "/a/only-a" },
      ],
      agents: [],
    },
    { repo: "owner/b", ref: "v2", skills: [{ name: "shared", sourcePath: "/b/shared" }], agents: [] },
  ]);

  assert.deepEqual(plan.skills, [
    { name: "only-a", sourcePath: "/a/only-a", repo: "owner/a", ref: "main" },
    { name: "shared", sourcePath: "/b/shared", repo: "owner/b", ref: "v2" },
  ]);
  assert.deepEqual(plan.replacements, [{ kind: "skills", name: "shared", replaced: "owner/a", by: "owner/b" }]);
});

test("buildPlan keeps skills and agents of the same name independent", () => {
  const plan = buildPlan([
    { repo: "owner/a", ref: "main", skills: [{ name: "x", sourcePath: "/a/s" }], agents: [] },
    { repo: "owner/b", ref: "main", skills: [], agents: [{ name: "x", sourcePath: "/b/x.md" }] },
  ]);
  assert.equal(plan.skills[0]?.repo, "owner/a");
  assert.equal(plan.agents[0]?.repo, "owner/b");
  assert.deepEqual(plan.replacements, []);
});
