import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { discoverModule, discoverWorkspace, getDependencies } from "@calmdownval/workspaces-util";

export interface BuildContext {
	readonly cwd: string;
	readonly moduleName: string;
	readonly targetEnv: TargetEnv;

	/** @internal */
	addBuildTask(block: BuildTask): void;
}

export type TargetEnv =
	| "development"
	| "staging"
	| "production";

/** @internal */
export interface BuildTask {
	(context: BuildContext): Promise<void>;
}


let currentContext: BuildContext | null = null;

/** @internal */
export function runBuild(block: BuildTask) {
	if (!currentContext) {
		throw new Error('Could not get build context. Please use the rollup-build command.');
	}

	currentContext.addBuildTask(block);
}

const ENV_MAP: { readonly [K in string]?: TargetEnv } = {
	dev: "development",
	development: "development",
	stag: "staging",
	staging: "staging",
	prod: "production",
	production: "production",
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
			? ENV_MAP[process.env.BUILD_ENV] ?? "production"
			: "production";

		// build!
		for (const currentModule of moduleQueue) {
			const taskQueue: BuildTask[] = [];
			currentContext = {
				cwd: currentModule.baseDir,
				moduleName: currentModule.declaration.name,
				targetEnv,
				addBuildTask: block => {
					taskQueue.push(block);
				},
			};

			// import the build.targets.mjs definition file
			process.chdir(currentContext.cwd);
			try {
				const url = pathToFileURL(join(currentContext.cwd, "build.targets.mjs")).href;
				await import(url);
			}
			catch {
				// likely no such file exists, skip it...
				continue;
			}

			// run queued tasks
			for (const task of taskQueue) {
				await task(currentContext);
			}
		}
	}
	finally {
		currentContext = null;
	}
}
