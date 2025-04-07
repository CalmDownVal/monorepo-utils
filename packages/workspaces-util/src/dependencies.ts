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
	buildOrder: GraphNode[];
	root: GraphNode;
}

export interface GraphNode {
	module: Module;
	dependencies: GraphNode[];
	dependents: GraphNode[];

	/** @internal */
	visited?: boolean;

	/** @internal */
	visiting?: boolean;
}

/**
 * Builds an ordered list of other workspace modules that are either direct or
 * indirect dependency of the queried module.
 */
export const getDependencies = createTraversal("dependencies", "push");

/**
 * Builds an ordered list of workspace modules that either directly or
 * indirectly depend on the queried workspace.
 */
export const getDependents = createTraversal("dependents", "unshift");

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
		graph[module.declaration.name] = {
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
		if (excluded[module.declaration.name] === true) {
			continue;
		}

		upstream = graph[module.declaration.name]!;
		for (mapIndex = 0; mapIndex < mapCount; mapIndex += 1) {
			if (!(dependencyMap = module.declaration[mapKeys[mapIndex]])) {
				continue;
			}

			for (moduleSubIndex = 0; moduleSubIndex < moduleCount; moduleSubIndex += 1) {
				downstream = graph[modules[moduleSubIndex].declaration.name]!;
				if (excluded[downstream.module.declaration.name] === true ||
					dependencyMap[downstream.module.declaration.name]?.startsWith("workspace:") !== true
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

function createTraversal(
	branchKey: "dependencies" | "dependents",
	direction: "push" | "unshift",
): DependencyTraversal {
	return options => {
		const graph = buildGraph(options.workspace, options);
		const origin = graph[options.moduleName];
		if (!origin) {
			throw new Error(`No module '${options.moduleName}' could be found in the workspace.`);
		}

		const buildOrder: GraphNode[] = [];
		let cycleStart: GraphNode | null = null;
		let cycleInfo = "";

		const visit = (node: GraphNode) => {
			if (node.visited) {
				return true;
			}

			if (node.visiting) {
				cycleStart = node;
				cycleInfo = node.module.declaration.name;
				return false;
			}

			node.visiting = true;

			const branch = node[branchKey];
			let index = 0;
			for (; index < branch.length; index += 1) {
				if (!visit(branch[index])) {
					if (cycleStart === node) {
						throw new Error(`Dependency cycle found: [-> ${cycleInfo} ->]`);
					}

					cycleInfo += ` -> ${node.module.declaration.name}`;
					return false;
				}
			}

			node.visiting = false;
			node.visited = true;

			if (node !== origin || options.includeSelf !== false) {
				buildOrder[direction](node);
			}

			return true;
		};

		visit(origin);

		// filter the results to the requested scope
		const affected = new WeakSet<GraphNode>();
		buildOrder.forEach(node => {
			affected.add(node);
		});

		const isAffected = (node: GraphNode) => affected.has(node);
		buildOrder.forEach(node => {
			node.dependencies = node.dependencies.filter(isAffected);
			node.dependents = node.dependents.filter(isAffected);
		});

		return {
			buildOrder,
			root: origin,
		};
	};
}
