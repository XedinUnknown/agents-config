import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLayer, mergeLayers, dependencyKey } from "./layer.ts";

const names = (layers: Parameters<typeof mergeLayers>[0]) => mergeLayers(layers).targets.map((t) => t.name);

test("parseLayer reads the shared schema", () => {
  const layer = parseLayer(
    [
      "clone_method: ssh",
      "install_method: link",
      "targets:",
      "  claude: true",
      "  interop: false",
      "  agents-root:",
      "    paths: { skills: skills, agents: agents }",
      "dependencies:",
      "  - repo: owner/repo",
    ].join("\n"),
    "test.yaml"
  );
  assert.deepEqual(layer, {
    clone_method: "ssh",
    install_method: "link",
    targets: { claude: true, interop: false, "agents-root": { paths: { skills: "skills", agents: "agents" } } },
    dependencies: [{ repo: "owner/repo", ref: "main", skills: "*", agents: "*" }],
  });
});

test("parseLayer treats an empty file as an empty layer", () => {
  assert.deepEqual(parseLayer("", "test.yaml"), {});
});

test("parseLayer normalizes dependency defaults and explicit selections", () => {
  const layer = parseLayer(
    [
      "dependencies:",
      "  - repo: owner/repo-a",
      "    ref: v1",
      "    skills: false",
      "    agents: [foo, bar]",
      "  - repo: owner/repo-b",
      "    skills: true",
      "    agents: false",
    ].join("\n"),
    "test.yaml"
  );
  assert.deepEqual(layer.dependencies, [
    { repo: "owner/repo-a", ref: "v1", skills: false, agents: ["foo", "bar"] },
    { repo: "owner/repo-b", ref: "main", skills: "*", agents: false },
  ]);
});

test("parseLayer rejects invalid values, naming the source file", () => {
  assert.throws(() => parseLayer("clone_method: ftp\n", "x.yaml"), /x\.yaml: invalid clone_method/);
  assert.throws(() => parseLayer("install_method: move\n", "x.yaml"), /invalid install_method/);
  assert.throws(() => parseLayer("targets: [claude]\n", "x.yaml"), /'targets' must be a map/);
  assert.throws(() => parseLayer("targets:\n  foo: [a]\n", "x.yaml"), /target 'foo' must be/);
  assert.throws(() => parseLayer("targets:\n  foo:\n    handler: 1\n", "x.yaml"), /handler must be a non-empty string/);
  assert.throws(() => parseLayer("dependencies: not-a-list\n", "x.yaml"), /must be an array/);
  assert.throws(() => parseLayer("dependencies:\n  - ref: main\n", "x.yaml"), /exactly one of 'repo' or 'path'/);
});

test("parseLayer rejects agentdeps' agents/custom_agents keys with a hint to use targets", () => {
  assert.throws(() => parseLayer("agents: [claude]\n", "config.yaml"), /no longer supported; use 'targets'/);
  assert.throws(
    () => parseLayer("custom_agents:\n  root:\n    project_skills: skills\n", "config.yaml"),
    /no longer supported/
  );
});

test("mergeLayers has no default target; it reports whether any layer declared targets", () => {
  assert.deepEqual(mergeLayers([]).targets, []);
  assert.equal(mergeLayers([{ clone_method: "ssh" }, {}]).targetsDeclared, false);
  assert.equal(mergeLayers([{ targets: {} }]).targetsDeclared, true);
});

test("mergeLayers keeps first-appearance order: re-declaring an inherited target doesn't move it", () => {
  const settings = mergeLayers([
    { targets: { interop: true, "claude-interop": true } },
    { targets: { codex: true, interop: { paths: { skills: "s" } } } },
  ]);
  assert.deepEqual(
    settings.targets.map((t) => t.name),
    ["interop", "claude-interop", "codex"]
  );
});

test("mergeLayers: an explicit empty targets map enables nothing", () => {
  assert.deepEqual(names([{ targets: {} }]), []);
});

test("mergeLayers: true enables a built-in, false disables an inherited target", () => {
  assert.deepEqual(names([{ targets: { claude: true, codex: true } }, { targets: { codex: false } }]), ["claude"]);
});

test("mergeLayers: a declared targets map replaces the interop fallback rather than adding to it", () => {
  assert.deepEqual(names([{ targets: { claude: true } }]), ["claude"]);
});

test("mergeLayers: a target uses the handler named like it, with only the settings config gives", () => {
  assert.deepEqual(mergeLayers([{ targets: { claude: true } }]).targets, [{ name: "claude", handler: "claude", options: {} }]);
});

test("mergeLayers: later layers merge a target's settings by key; null is kept for the handler to default", () => {
  const settings = mergeLayers([
    { targets: { root: { handler: "interop", paths: { skills: "s", agents: "a" }, extra: [1] } } },
    { targets: { root: { paths: { agents: null }, extra: [2] } } },
  ]);
  assert.deepEqual(settings.targets, [
    { name: "root", handler: "interop", options: { paths: { skills: "s", agents: null }, extra: [2] } },
  ]);
});

test("mergeLayers: disabling and re-enabling a target keeps its settings", () => {
  const settings = mergeLayers([
    { targets: { claude: { paths: { skills: "custom-skills" } } } },
    { targets: { claude: false } },
    { targets: { claude: true } },
  ]);
  assert.deepEqual(settings.targets, [{ name: "claude", handler: "claude", options: { paths: { skills: "custom-skills" } } }]);
});

test("mergeLayers: naming a different handler starts that target's settings fresh", () => {
  const settings = mergeLayers([
    { targets: { codex: { paths: { skills: "x" } } } },
    { targets: { codex: { handler: "codex-plugin", marketplace: "local" } } },
  ]);
  assert.deepEqual(settings.targets, [{ name: "codex", handler: "codex-plugin", options: { marketplace: "local" } }]);
});

test("mergeLayers: scalars replace, later layer wins; defaults are https/copy", () => {
  assert.equal(mergeLayers([]).clone_method, "https");
  assert.equal(mergeLayers([]).install_method, "copy");
  const settings = mergeLayers([{ clone_method: "ssh", install_method: "link" }, { install_method: "copy" }]);
  assert.equal(settings.clone_method, "ssh");
  assert.equal(settings.install_method, "copy");
});

test("mergeLayers: a later entry for the same repo replaces the earlier one in place; new repos append", () => {
  const settings = mergeLayers([
    {
      dependencies: [
        { repo: "owner/a", ref: "main", skills: "*", agents: "*" },
        { repo: "owner/b", ref: "main", skills: "*", agents: "*" },
      ],
    },
    {
      dependencies: [
        { repo: "Owner/A.git", ref: "v2", skills: ["x"], agents: false },
        { repo: "owner/c", ref: "main", skills: "*", agents: "*" },
      ],
    },
  ]);
  assert.deepEqual(
    settings.dependencies.map((d) => ["repo" in d ? d.repo : d.path, d.ref]),
    [
      ["Owner/A.git", "v2"],
      ["owner/b", "main"],
      ["owner/c", "main"],
    ]
  );
});

test("dependencyKey ignores case and a trailing .git for repos, normalizes paths, and keeps the two apart", () => {
  const repo = (r: string) => dependencyKey({ repo: r, ref: "main", skills: "*", agents: "*" });
  const path = (p: string) => dependencyKey({ path: p, skills: "*", agents: "*" });
  assert.equal(repo("Owner/Repo.git"), repo("owner/repo"));
  assert.equal(path("./"), path("."));
  assert.equal(path("packages/x/"), path("./packages/x"));
  assert.notEqual(path("owner/repo"), repo("owner/repo"));
});

test("parseLayer: repo accepts URIs and owner/repo only, and rejects bare paths with a hint", () => {
  for (const repo of ["owner/repo", "https://github.com/o/r.git", "git@github.com:o/r.git", "file:///srv/git/r", "ssh://git@host/o/r"]) {
    assert.equal(parseLayer(`dependencies:\n  - repo: ${repo}\n`, "x.yaml").dependencies?.length, 1, repo);
  }
  for (const repo of [".", "./skills", "../other", "/home/owner/repo", "~/repo"]) {
    assert.throws(
      () => parseLayer(`dependencies:\n  - repo: "${repo}"\n`, "x.yaml"),
      /not a repository URI or owner\/repo\. Use 'path:' for a folder, or a file:\/\/ URI/,
      repo
    );
  }
});

test("parseLayer: path dependencies, optional ref and install_method; exactly one of repo/path", () => {
  assert.deepEqual(
    parseLayer("dependencies:\n  - path: .\n  - path: ../lib\n    ref: v1\n    install_method: copy\n", "x.yaml").dependencies,
    [
      { path: ".", skills: "*", agents: "*" },
      { path: "../lib", ref: "v1", skills: "*", agents: "*", install_method: "copy" },
    ]
  );
  assert.throws(() => parseLayer("dependencies:\n  - path: .\n    repo: o/r\n", "x.yaml"), /exactly one of 'repo' or 'path'/);
  assert.throws(() => parseLayer("dependencies:\n  - skills: false\n", "x.yaml"), /exactly one of 'repo' or 'path'/);
  assert.throws(() => parseLayer("dependencies:\n  - path: .\n    install_method: move\n", "x.yaml"), /install_method must be/);
});
