import type { Module, Workspace } from "./types";

export interface GraphOptions {
	readonly workspace: Workspace;
	readonly dependencyMaps?: readonly DependencyMapKey[];
	readonly exclude?: readonly string[];
}

export interface TraversalOptions extends GraphOptions {
	readonly moduleName: string;
	readonly includeSelf?: boolean;
}

export interface DependencyTraversal {
	(options: TraversalOptions): TraversalResult;
}

export interface TraversalResult {
	orderedNodes: GraphNode[];
	origin: GraphNode;
}

export interface GraphNode {
	module: Module;

	/** list of modules this module depends on */
	dependencies: GraphNode[];

	/** list of modules that depend on this module */
	dependents: GraphNode[];

	/** @internal */
	visited?: boolean;

	/** @internal */
	visiting?: boolean;
}

export type DependencyMapKey =
	| "dependencies"
	| "devDependencies"
	| "peerDependencies"
	| "optionalDependencies";

const DEFAULT_DEPENDENCY_MAPS: DependencyMapKey[] = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
];

type Graph = { [TModuleName in string]?: GraphNode };

function buildGraph(workspace: Workspace, options?: GraphOptions): Graph {
	const { modules } = workspace;
	const moduleCount = modules.length;
	const graph: Graph = {};

	let moduleIndex = 0;
	let module;

	for (; moduleIndex < moduleCount; moduleIndex += 1) {
		module = modules[moduleIndex];
		graph[module.package.name] = {
			module,
			dependencies: [],
			dependents: [],
		};
	}

	const mapKeys = options?.dependencyMaps ?? DEFAULT_DEPENDENCY_MAPS;
	const mapCount = mapKeys.length;
	const excluded = options?.exclude?.reduce<{ [K in string]?: true }>((map, name) => {
		map[name] = true;
		return map;
	}, {}) ?? {};

	let mapIndex;
	let moduleSubIndex;
	let dependencyMap: { readonly [K in string]?: string } | undefined;
	let upstream: GraphNode;
	let downstream: GraphNode | undefined;

	for (moduleIndex = 0; moduleIndex < moduleCount; moduleIndex += 1) {
		module = modules[moduleIndex];
		if (excluded[module.package.name] === true) {
			continue;
		}

		upstream = graph[module.package.name]!;
		for (mapIndex = 0; mapIndex < mapCount; mapIndex += 1) {
			if (!(dependencyMap = module.package[mapKeys[mapIndex]])) {
				continue;
			}

			for (moduleSubIndex = 0; moduleSubIndex < moduleCount; moduleSubIndex += 1) {
				downstream = graph[modules[moduleSubIndex].package.name]!;
				if (excluded[downstream.module.package.name] === true ||
					dependencyMap[downstream.module.package.name]?.startsWith("workspace:") !== true
				) {
					continue;
				}

				upstream.dependencies.push(downstream);
				downstream.dependents.push(upstream);
			}
		}
	}

	return graph;
}

function createTraversal(isUpwards: boolean): DependencyTraversal {
	return options => {
		const graph = buildGraph(options.workspace, options);
		const origin = graph[options.moduleName];
		if (!origin) {
			throw new Error(`No module '${options.moduleName}' could be found in the workspace.`);
		}

		const affected = new WeakSet<GraphNode>();
		const orderedNodes: GraphNode[] = [];
		let cycleStart: GraphNode | null = null;
		let cycleInfo = "";

		const visit = (node: GraphNode) => {
			if (node.visited) {
				return true;
			}

			if (node.visiting) {
				cycleStart = node;
				cycleInfo = node.module.package.name;
				return false;
			}

			node.visiting = true;

			const relatives = isUpwards ? node.dependents : node.dependencies;
			let index = 0;
			for (; index < relatives.length; index += 1) {
				if (!visit(relatives[index])) {
					if (cycleStart === node) {
						throw new Error(`Dependency cycle found: [-> ${cycleInfo} ->]`);
					}

					cycleInfo += ` -> ${node.module.package.name}`;
					return false;
				}
			}

			node.visiting = false;
			node.visited = true;

			if (node !== origin || options.includeSelf !== false) {
				orderedNodes.push(node);
				affected.add(node);
			}

			return true;
		};

		visit(origin);

		// filter the results to the requested scope
		const isAffected = (node: GraphNode) => affected.has(node);
		orderedNodes.forEach(node => {
			node.dependencies = node.dependencies.filter(isAffected);
			node.dependents = node.dependents.filter(isAffected);
		});

		if (isUpwards) {
			orderedNodes.reverse();
		}

		return {
			orderedNodes,
			origin,
		};
	};
}

/**
 * Builds an ordered list of other workspace modules that are either direct or
 * indirect dependency of the queried module.
 */
export const getDependencies = createTraversal(/* isUpwards = */ false);

/**
 * Builds an ordered list of workspace modules that either directly or
 * indirectly depend on the queried workspace.
 */
export const getDependents = createTraversal(/* isUpwards = */ true);
