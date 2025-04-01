import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { identity, isENOENT } from "./common";
import { resolveGlob } from "./glob";
import type { Module, Workspace } from "./types";

export interface DiscoverOptions {
	/**
	 * The directory where the discovery begins.
	 *
	 * Defaults to the current working directory.
	 */
	readonly cwd?: string;

	/**
	 * Limits the depth to which scanning for root package.json will take place.
	 *
	 * Defaults to 5.
	 */
	readonly maxDepth?: number;
}

/**
 * Attempts to discover the workspace containing the current working directory. Resolves to the
 * discovered Workspace, or null if no workspace can be found.
 */
export async function discoverWorkspace(options?: DiscoverOptions): Promise<Workspace | null> {
	const maxDepth = Math.max(1, options?.maxDepth ?? 5);

	let cwd = options?.cwd ? resolve(options.cwd) : process.cwd();
	let depth = 1;
	let root;

	while (depth <= maxDepth) {
		root = await discoverModule(cwd);
		if (root?.declaration.workspaces) {
			break;
		}

		const parent = join(cwd, "..");
		if (parent === cwd) {
			break;
		}

		cwd = parent;
		depth += 1;
	}

	if (!root?.declaration.workspaces) {
		return null;
	}

	const globOptions = { cwd };
	const paths = (
		await Promise.all(
			root.declaration.workspaces.map(it => resolveGlob(it, globOptions))
		)
	)
		.flatMap(identity);

	const modules = (
		await Promise.all(
			paths.map(discoverModule)
		)
	)
		.filter(Boolean) as Module[];

	return {
		root,
		modules,
	};
}

/**
 * Attempts to read a 'package.json' file within the specified directory and resolves gathered
 * information into a Module object.
 */
export async function discoverModule(dir: string): Promise<Module | null> {
	const path = join(dir, "./package.json");
	let json;
	try {
		json = await readFile(path, "utf8");
	}
	catch (ex) {
		if (isENOENT(ex)) {
			// directory is not a package root - an expected possibility
			return null;
		}

		throw ex as Error;
	}

	try {
		return {
			baseDir: dir,
			declaration: JSON.parse(json),
		};
	}
	catch (ex) {
		throw new Error(`Could not parse 'package.json' file at '${path}'.`, {
			cause: ex,
		});
	}
}

/**
 * Gets a workspace module by name, or null if not found.
 */
export function getModuleOrNull(workspace: Workspace, moduleName: string): Module | null {
	if (workspace.root.declaration.name === moduleName) {
		return workspace.root;
	}

	return workspace.modules.find(it => it.declaration.name === moduleName) ?? null;
}

/**
 * Gets a workspace module by name; Throws if not found.
 */
export function getModule(workspace: Workspace, moduleName: string): Module {
	const module = getModuleOrNull(workspace, moduleName);
	if (!module) {
		throw new Error(`No module '${moduleName}' could be found in the workspace.`);
	}

	return module;
}
