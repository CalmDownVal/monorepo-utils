import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { discoverModule, discoverWorkspace, getDependencies, Module } from "@calmdownval/workspaces-util";

export interface BuildContext {
	readonly cwd: string;
	readonly targetEnv: TargetEnv;
}

export type TargetEnv =
	| "development"
	| "staging"
	| "production";


let currentContext: BuildContext | null = null;

export function getContext(): BuildContext {
	if (!currentContext) {
		throw new Error('Could not get build context. Please use the rollup-build command.');
	}

	return currentContext;
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
		// get the module to build
		const module = await discoverModule(cwd);
		if (!module) {
			throw new Error(`No module found at path '${cwd}'.`);
		}

		// get an ordered queue of dependencies that need to be built
		const workspace = await discoverWorkspace({ cwd });
		const queue = workspace
			? getDependencies({
				workspace,
				moduleName: module.declaration.name,
			})
			: [ module ];

		// prepare the context object
		const targetEnv: TargetEnv = process.env.BUILD_ENV
			? ENV_MAP[process.env.BUILD_ENV] ?? "production"
			: "production";

		const context: BuildContext = {
			cwd,
			targetEnv,
		};

		// build!
		for (const currentModule of queue) {
			currentContext = {
				...context,
				cwd: currentModule.baseDir,
			}

			const url = pathToFileURL(join(currentContext.cwd, "build.targets.mjs")).href;
			await import(url);
		}
	}
	finally {
		currentContext = null;
	}
}
