import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { discoverModule, discoverWorkspace, getDependencies, type GraphNode, type Module, type TraversalResult } from "@calmdownval/workspaces-util";
import { rollup, type InputOptions, type OutputOptions } from "rollup";

import type { Configurator } from "./Entity";
import { createStatusReporter, formatTime, print } from "./StatusReporter";

export interface BuildContext {
	readonly cwd: string;
	readonly moduleName: string;
	readonly targetEnv: TargetEnv;
}

export type TargetEnv =
	| "dev"
	| "stag"
	| "prod";

export function inEnv(...envs: TargetEnv[]): Configurator<any> {
	return (_, context) => envs.includes(context.targetEnv);
}


/** @internal */
export interface BuildTarget {
	readonly name: string;
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
		throw new Error("Build has not been initiated. Please use the rollup-build command.");
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

export async function build(cwd: string = process.cwd()) {
	const buildStartTime = Date.now();
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

		const status = createStatusReporter(tree.root, "queued");

		// get the target environment
		const targetEnv: TargetEnv = process.env.BUILD_ENV
			? ENV_MAP[process.env.BUILD_ENV] ?? "prod"
			: "prod";

		// build!
		for (const currentNode of tree.buildOrder) {
			const moduleStartTime = Date.now();
			status.update(currentNode, { kind: "pending" });

			const context: BuildContext = {
				cwd: currentNode.module.baseDir,
				moduleName: currentNode.module.declaration.name,
				targetEnv,
			};

			let target: BuildTarget | null = null;
			try {
				// import the build.config.mjs definition file
				currentTasks = [];
				process.chdir(context.cwd);

				const url = pathToFileURL(join(context.cwd, "build.config.mjs")).href;
				await import(url);

				// process queued tasks
				const targets = (
					await Promise.all(
						currentTasks.map(task => task(context)),
					)
				)
					.flat(1);

				// build targets sequentially
				for (target of targets) {
					const bundle = await rollup({
						...target.input,
						onLog(level, log) {
							if (level !== "debug") {
								status.log(currentNode, log.message);
							}
						}
					});

					for (const output of target.outputs) {
						await bundle.write(output);
					}
				}

				const moduleTimeTaken = Date.now() - moduleStartTime;
				status.update(currentNode, {
					kind: "success",
					timeMs: moduleTimeTaken,
				});
			}
			catch (ex) {
				const moduleTimeTaken = Date.now() - moduleStartTime;
				status.update(currentNode, {
					kind: "error",
					timeMs: moduleTimeTaken,
				});

				status.log(currentNode, (ex as Error).toString());
			}
		}
	}
	finally {
		currentTasks = null;

		const buildTimeTaken = Date.now() - buildStartTime;
		print(`\nDone in ${formatTime(buildTimeTaken)}!\n`);
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
