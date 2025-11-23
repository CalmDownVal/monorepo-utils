import { access, constants as FSConstants } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { discoverModule, discoverWorkspace, getDependencies, type GraphNode, type Module, type TraversalResult } from "@calmdownval/workspaces-util";
import { rollup, watch, type InputOptions, type OutputOptions, type RollupWatcher, type WatcherOptions } from "rollup";

import type { Configurator } from "./Entity";
import { createStatusReporter, formatTime, overrideConsole, println, type StatusKind, type StatusReporter } from "./status";

export interface BuildContext {
	readonly cwd: string;
	readonly moduleName: string;
	readonly targetEnv: TargetEnv;
	readonly isWatching: boolean;
	readonly isDebug: boolean;
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

	// debug mode
	const isDebug = args.some(arg => /^--debug$/i.test(arg));

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
				moduleName: originModule.package.name,
				exclude: [ "build-logic" ],
			})
			: singleNode(originModule);

		status = createStatusReporter(tree.origin);
		overrideConsole(status);

		// build!
		for (const currentNode of tree.orderedNodes) {
			let moduleStartTime = Date.now();
			const context: BuildContext = {
				cwd: currentNode.module.baseDir,
				moduleName: currentNode.module.package.name,
				targetEnv,
				isWatching,
				isDebug,
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
					await (isWatching ? buildAndWatch : buildOnce)({
						context,
						status,
						node: currentNode,
						outputs: target.outputs,
						inputOptions: {
							...target.input,
							onLog(level, log) {
								if (log.code !== undefined && target.suppressed.has(log.code)) {
									return;
								}

								if (level !== "debug" || isDebug) {
									status!.log(currentNode, log.message, level);
								}
							},
						},
						registerWatcher: (watcher) => {
							watchers.push(watcher);
						},
					});
				}
			}
			catch (ex: any) {
				bundleFinished(status, currentNode, moduleStartTime, "FAIL");
				status.log(currentNode, isDebug ? ex.stack ?? ex.toString() : ex.toString(), "error");
			}
		}

		// watch mode suspend
		if (isWatching) {
			await new Promise<void>((resolve) => {
				let isTearingDown = false;
				const onTeardown = () => {
					if (isTearingDown) {
						return;
					}

					isTearingDown = true;
					Promise
						.allSettled(watchers.map((it) => it.close()))
						.finally(resolve);
				};

				[ "SIGTERM", "SIGINT" ].forEach(signal => process.on(signal, onTeardown));
			});
		}
	}
	finally {
		currentTasks = null;
		status?.close();

		const buildTimeTaken = Date.now() - buildStartTime;
		println();
		println(`Done in ${formatTime(buildTimeTaken)}!`);
		process.exit(0);
	}
}

interface BuildCall {
	readonly context: BuildContext;
	readonly node: GraphNode;
	readonly inputOptions: InputOptions;
	readonly outputs: readonly OutputOptions[];
	readonly status: StatusReporter;
	readonly registerWatcher?: (watcher: RollupWatcher) => void;
}

async function buildOnce({ node, inputOptions, outputs, status }: BuildCall) {
	const startTime = Date.now();
	status.update(node, { kind: "BUSY" });

	const bundle = await rollup(inputOptions);
	for (const output of outputs) {
		await bundle.write(output);
	}

	await bundle.close();
	bundleFinished(status, node, startTime, "PASS");
}

function buildAndWatch({ context, node, inputOptions, outputs, status, registerWatcher }: BuildCall) {
	return new Promise<void>((resolve, reject) => {
		let isFirstRun = true;
		let startTime = 0;
		const watcher = watch({
			...inputOptions,
			output: outputs as OutputOptions[],
			watch: {
				buildDelay: 50,
				clearScreen: false,
			},
		});

		registerWatcher?.(watcher);
		watcher.on("event", async (e) => {
			switch (e.code) {
				case "START":
					startTime = Date.now();
					process.chdir(context.cwd);
					status!.update(node, { kind: "BUSY" });
					break;

				case "BUNDLE_START":
					break;

				case "BUNDLE_END":
					await e.result.close();
					break;

				case "END":
					bundleFinished(status!, node, startTime, "PASS");
					if (isFirstRun) {
						isFirstRun = false;
						resolve();
					}

					break;

				case "ERROR":
					bundleFinished(status!, node, startTime, "FAIL");
					if (isFirstRun) {
						isFirstRun = false;
						reject(e.error);
					}
					else {
						status!.log(node, context.isDebug ? e.error.stack ?? e.error.toString() : e.error.toString(), "error");
					}

					break;
			}
		});
	});
}

function singleNode(module: Module): TraversalResult {
	const node: GraphNode = {
		module,
		dependencies: [],
		dependents: [],
	};

	return {
		orderedNodes: [ node ],
		origin: node,
	};
}

function bundleFinished(status: StatusReporter, node: GraphNode, startTime: number, result: StatusKind) {
	const timeTaken = Date.now() - startTime;
	status.update(node, {
		kind: result,
		timeMs: timeTaken,
	});
}
