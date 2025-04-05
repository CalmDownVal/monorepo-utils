import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { discoverModule, discoverWorkspace, getDependencies } from "@calmdownval/workspaces-util";
import { rollup, type InputOptions, type OutputOptions } from "rollup";

import type { Configurator } from "./Entity";

export interface BuildContext {
	readonly cwd: string;
	readonly moduleName: string;
	readonly targetEnv: TargetEnv;
}

export type TargetEnv =
	| "dev"
	| "stag"
	| "prod";

export function inEnvs(...envs: TargetEnv[]): Configurator<any> {
	return (_, context) => envs.includes(context.targetEnv);
}


/** @internal */
export interface BuildTarget {
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
	try {
		// get the origin module to build
		const originModule = await discoverModule(cwd);
		if (!originModule) {
			throw new Error(`No module found at path '${cwd}'.`);
		}

		// get an ordered queue of dependencies that need to be built
		const workspace = await discoverWorkspace({ cwd });
		const moduleQueue = workspace
			? getDependencies({
				workspace,
				moduleName: originModule.declaration.name,
			})
			: [ originModule ];

		// get the target environment
		const targetEnv: TargetEnv = process.env.BUILD_ENV
			? ENV_MAP[process.env.BUILD_ENV] ?? "prod"
			: "prod";

		// build!
		for (const currentModule of moduleQueue) {
			const context: BuildContext = {
				cwd: currentModule.baseDir,
				moduleName: currentModule.declaration.name,
				targetEnv,
			};

			// import the build.targets.mjs definition file
			currentTasks = [];
			process.chdir(context.cwd);
			try {
				const url = pathToFileURL(join(context.cwd, "build.targets.mjs")).href;
				await import(url);
			}
			catch {
				// likely no such file exists, skip it...?
				continue;
			}

			// run queued tasks
			const targets = (
				await Promise.all(
					currentTasks.map(task => task(context)),
				)
			)
				.flat(1);

			// build the targets sequentially
			for (const target of targets) {
				const bundle = await rollup(target.input);
				for (const output of target.outputs) {
					await bundle.write(output);
				}
			}
		}
	}
	finally {
		currentTasks = null;
	}
}
