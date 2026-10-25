/**
 * CLI command bodies. The host (index.ts) bridges commander's dispatch to
 * these resolved definitions (Bootstrap Pattern step 8) rather than its
 * `.action()` callbacks importing and calling application functions
 * directly.
 */
import { join } from "node:path";
import { resolveRepoUrl, deriveCacheKey, type EnsureRepoFn } from "./cache.ts";
import { dependencyKey, mergeLayers, type Dependency, type Layer, type Selection } from "./layer.ts";
import type { DiscoveredItem } from "./discovery.ts";
import type { Container, Provider } from "./di/index.ts";

type SaveDependenciesFn = (path: string, dependencies: readonly Dependency[]) => Promise<void>;

function describeSelection(selection: Selection): string {
  return selection === "*" ? "all" : selection === false ? "none" : selection.join(", ");
}

export interface AddCommandOptions {
  ref: string;
  skill: string[];
  agent: string[];
  skills: boolean; // commander's --no-skills sets this to false
  agents: boolean;
  allSkills: boolean;
  allAgents: boolean;
}

export function cliProvider(): Provider {
  return {
    definitions: {
      "cli/install": (c: Container) => async (): Promise<void> => {
        const runInstall = c.resolve<() => Promise<void>>("run/install");
        await runInstall();
      },

      "cli/list": (c: Container) => async (): Promise<void> => {
        const machine = await c.resolve<Promise<Layer>>("config/loaded");
        const cwd = c.resolve<string>("platform/cwd");
        const manifestExists = c.resolve<(path: string) => Promise<boolean>>("manifest/exists");
        const loadManifest = c.resolve<(path: string) => Promise<Layer>>("manifest/load");

        const projectPath = join(cwd, "agents.yaml");
        const project = (await manifestExists(projectPath)) ? await loadManifest(projectPath) : {};
        const settings = mergeLayers([machine, project]);

        if (settings.dependencies.length === 0) {
          console.log("No dependencies configured. Add one with: agents-config add <owner/repo>");
          return;
        }

        const projectKeys = new Set((project.dependencies ?? []).map((d) => dependencyKey(d.repo)));
        for (const dep of settings.dependencies) {
          const source = projectKeys.has(dependencyKey(dep.repo)) ? "agents.yaml" : "config.yaml";
          console.log(`  ${dep.repo} (ref: ${dep.ref}, from ${source})`);
          console.log(`    skills: ${describeSelection(dep.skills)}`);
          console.log(`    agents: ${describeSelection(dep.agents)}`);
        }
        console.log(
          `targets: ${settings.targetsDeclared ? settings.targets.map((t) => t.name).join(", ") || "(none enabled)" : "(none declared)"}`
        );
      },

      "cli/add":
        (c: Container) =>
        async (repo: string, options: AddCommandOptions): Promise<void> => {
          const machine = await c.resolve<Promise<Layer>>("config/loaded");
          const cwd = c.resolve<string>("platform/cwd");
          const ensureRepo = c.resolve<EnsureRepoFn>("repo/ensure");
          const discoverSkills = c.resolve<(repoPath: string) => Promise<DiscoveredItem[]>>("discovery/skills");
          const discoverAgents = c.resolve<(repoPath: string) => Promise<DiscoveredItem[]>>("discovery/agents");
          const manifestExists = c.resolve<(path: string) => Promise<boolean>>("manifest/exists");
          const loadManifest = c.resolve<(path: string) => Promise<Layer>>("manifest/load");
          const saveDependencies = c.resolve<SaveDependenciesFn>("manifest/save");
          const runInstall = c.resolve<() => Promise<void>>("run/install");

          const targetPath = join(cwd, "agents.yaml");
          const project = (await manifestExists(targetPath)) ? await loadManifest(targetPath) : {};
          const settings = mergeLayers([machine, project]);

          const url = resolveRepoUrl(repo, settings.clone_method);
          const cacheKey = deriveCacheKey(repo, options.ref);
          console.log(`fetching ${repo}...`);
          const cached = await ensureRepo(url, options.ref, cacheKey);
          if (!cached.success) {
            console.error(`✗ failed to clone ${repo}: ${cached.error ?? "unknown error"}`);
            process.exit(1);
          }

          const [discoveredSkills, discoveredAgents] = await Promise.all([
            discoverSkills(cached.path),
            discoverAgents(cached.path),
          ]);
          console.log(
            `  found ${discoveredSkills.length} skill(s): ${discoveredSkills.map((s) => s.name).join(", ") || "(none)"}`
          );
          console.log(
            `  found ${discoveredAgents.length} agent(s): ${discoveredAgents.map((a) => a.name).join(", ") || "(none)"}`
          );

          const skills: Selection =
            options.skills === false ? false : options.allSkills || options.skill.length === 0 ? "*" : options.skill;
          const agents: Selection =
            options.agents === false ? false : options.allAgents || options.agent.length === 0 ? "*" : options.agent;

          const dep: Dependency = { repo, ref: options.ref, skills, agents };

          const dependencies = [...(project.dependencies ?? [])];
          const idx = dependencies.findIndex((d) => dependencyKey(d.repo) === dependencyKey(repo));
          const verb = idx === -1 ? "added" : "updated";
          if (idx === -1) dependencies.push(dep);
          else dependencies[idx] = dep;

          await saveDependencies(targetPath, dependencies);
          console.log(`✓ ${verb} ${repo} in agents.yaml`);

          await runInstall();
        },

      "cli/remove":
        (c: Container) =>
        async (repo: string): Promise<void> => {
          const machine = await c.resolve<Promise<Layer>>("config/loaded");
          const cwd = c.resolve<string>("platform/cwd");
          const manifestExists = c.resolve<(path: string) => Promise<boolean>>("manifest/exists");
          const loadManifest = c.resolve<(path: string) => Promise<Layer>>("manifest/load");
          const saveDependencies = c.resolve<SaveDependenciesFn>("manifest/save");
          const runInstall = c.resolve<() => Promise<void>>("run/install");

          const targetPath = join(cwd, "agents.yaml");

          if (!(await manifestExists(targetPath))) {
            console.error("✗ no agents.yaml found in current directory");
            process.exit(1);
          }

          const dependencies = [...((await loadManifest(targetPath)).dependencies ?? [])];
          const idx = dependencies.findIndex((d) => dependencyKey(d.repo) === dependencyKey(repo));
          if (idx === -1) {
            const inMachine = (machine.dependencies ?? []).some((d) => dependencyKey(d.repo) === dependencyKey(repo));
            console.error(
              inMachine
                ? `✗ ${repo} is declared in config.yaml, not agents.yaml — remove it there`
                : `✗ ${repo} not found in agents.yaml`
            );
            process.exit(1);
          }

          const [removed] = dependencies.splice(idx, 1);
          await saveDependencies(targetPath, dependencies);
          console.log(`✓ removed ${removed?.repo} from agents.yaml`);

          await runInstall();
        },

      "cli/config": (c: Container) => async (): Promise<void> => {
        const path = await c.resolve<Promise<string>>("config/path");
        const cacheDir = c.resolve<string>("config/cacheDir");
        console.log(`Config: ${path}`);
        console.log(`Repo cache: ${cacheDir}`);
      },
    },
  };
}
