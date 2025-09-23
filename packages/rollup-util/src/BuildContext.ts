import { access, constants as FSConstants } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { discoverModule, discoverWorkspace, getDependencies, type GraphNode, type Module, type TraversalResult } from "@calmdownval/workspaces-util";
import { rollup, watch, type InputOptions, type OutputOptions, type RollupWatcher, type WatcherOptions } from "rollup";

import type { Configurator } from "./Entity";
import { createStatusReporter, formatTime, println, type StatusKind, type StatusReporter } from "./status";

export interface BuildContext {
	readonly cwd: string;
	readonly moduleName: string;
	readonly targetEnv: TargetEnv;
	readonly isWatching: boolean;
}

export type TargetEnv =
	| "dev"
	| "stag"
	| "prod";

export function inEnv(...envs: TargetEnv[]): Configurator<boolean> {
	return (_, context) => envs.includes(context.targetEnv);
}


/** @internal */
export interface BuildTarget {
	readonly name: string;
	readonly suppressed: Set<string>;
	readonly input: InputOptions;
	readonly outputs: readonly OutputOptions[];
}

/** @internal */
export interface BuildTask {
	(context: BuildContext): Promise<readonly BuildTarget[]>;
}

let currentTasks: BuildTask[] | null = null;

/** @internal */
export function buildTask(task: BuildTask) {
	if (!currentTasks) {
		throw new Error("Build has not been initiated. Please use the rollup-util API.");
	}

	currentTasks.push(task);
}


const ENV_MAP: { readonly [K in string]?: TargetEnv } = {
	dev: "dev",
	development: "dev",
	stag: "stag",
	staging: "stag",
	prod: "prod",
	production: "prod",
};

async function canAccessFile(path: string, mode: number = FSConstants.R_OK) {
	try {
		await access(path, mode);
		return true;
	}
	catch (_ex) {
		return false;
	}
}

export async function build(
	cwd: string = process.cwd(),
	args: readonly string[] = process.argv.slice(2),
) {
	const buildStartTime = Date.now();
	let status: StatusReporter | undefined;

	// detect environment
	const targetEnv: TargetEnv = (() => {
		let env: string | undefined;

		const i = args.findIndex(it => /^--env$/i.test(it));
		if (i !== -1 && i < args.length) {
			env = args[i + 1];
		}

		env ??= process.env.BUILD_ENV;
		env ??= process.env.ENVIRONMENT;

		return ENV_MAP[env?.toLowerCase() ?? ""] ?? "prod";
	})();

	// detect watch mode
	const isWatching = args.some(arg => /^--watch$/i.test(arg));
	const watchers: RollupWatcher[] = [];
	const watchOptions: WatcherOptions = {
		buildDelay: 500,
		clearScreen: false,
	};

	try {
		// get the origin module to build
		const originModule = await discoverModule(cwd);
		if (!originModule) {
			throw new Error(`No module found at path '${cwd}'.`);
		}

		// get an ordered queue of dependencies that need to be built
		const workspace = await discoverWorkspace({ cwd });
		const tree = workspace
			? getDependencies({
				workspace,
				moduleName: originModule.declaration.name,
				exclude: [ "build-logic" ],
			})
			: singleTree(originModule);

		status = createStatusReporter(tree.root);

		// build!
		for (const currentNode of tree.buildOrder) {
			let moduleStartTime = Date.now();
			const context: BuildContext = {
				cwd: currentNode.module.baseDir,
				moduleName: currentNode.module.declaration.name,
				targetEnv,
				isWatching,
			};

			try {
				// check for a build config
				const buildConfigPath = join(context.cwd, "build.config.mjs");
				if (!(await canAccessFile(buildConfigPath))) {
					status.update(currentNode, { kind: "SKIP" });
					continue;
				}

				// import the build.config.mjs definition file
				currentTasks = [];
				process.chdir(context.cwd);

				const url = pathToFileURL(buildConfigPath).href;
				await import(url);

				// process queued tasks
				const targets = (
					await Promise.all(
						currentTasks.map(task => task(context)),
					)
				)
					.flat(1);

				// build targets sequentially
				for (const target of targets) {
					const inputOptions: InputOptions = {
						...target.input,
						onLog(level, log) {
							if (log.code !== undefined && target.suppressed.has(log.code)) {
								return;
							}

							if (level !== "debug") {
								status!.log(currentNode, log.message);
							}
						},
					};

					if (isWatching) {
						const watcher = watch({
							...inputOptions,
							output: target.outputs as OutputOptions[],
							watch: watchOptions,
						});

						watchers.push(watcher);
						watcher.on("event", async (e) => {
							switch (e.code) {
								case "BUNDLE_START":
									moduleStartTime = Date.now();
									status!.update(currentNode, { kind: "BUSY" });
									break;

								case "BUNDLE_END":
									await e.result.close();
									bundleFinished(status!, currentNode, moduleStartTime, "PASS");
									break;

								case "ERROR":
									bundleFinished(status!, currentNode, moduleStartTime, "FAIL");
									status!.log(currentNode, e.error.toString());
									break;
							}
						});
					}
					else {
						status.update(currentNode, { kind: "BUSY" });

						const bundle = await rollup(inputOptions);
						for (const output of target.outputs) {
							await bundle.write(output);
						}

						await bundle.close();
						bundleFinished(status, currentNode, moduleStartTime, "PASS");
					}
				}
			}
			catch (ex) {
				bundleFinished(status, currentNode, moduleStartTime, "FAIL");
				status.log(currentNode, (ex as Error).toString());
			}
		}

		// watch mode suspend
		if (!isWatching) {
			return;
		}

		await new Promise<void>((resolve) => {
			process.on("SIGINT", () => {
				Promise
					.allSettled(watchers.map((it) => it.removeAllListeners().close()))
					.finally(resolve);
			});
		});
	}
	finally {
		currentTasks = null;
		status?.close();

		const buildTimeTaken = Date.now() - buildStartTime;
		println();
		println(`Done in ${formatTime(buildTimeTaken)}!`);
	}
}

function singleTree(module: Module): TraversalResult {
	const node: GraphNode = {
		module,
		dependencies: [],
		dependents: [],
	};

	return {
		buildOrder: [ node ],
		root: node,
	};
}

function bundleFinished(status: StatusReporter, node: GraphNode, startTime: number, result: StatusKind) {
	const timeTaken = Date.now() - startTime;
	status.update(node, {
		kind: result,
		timeMs: timeTaken,
	});
}
