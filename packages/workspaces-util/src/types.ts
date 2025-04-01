export interface Workspace {
	root: Module;
	modules: Module[];
}

export interface Module {
	baseDir: string;
	declaration: PackageDeclaration;
}

export interface PackageDeclaration {
	name: string;
	version: string;
	workspaces?: string[];
	dependencies?: DependencyMap;
	devDependencies?: DependencyMap;
	peerDependencies?: DependencyMap;
	optionalDependencies?: DependencyMap;
}

export type DependencyMap = { [TName in string]?: string };
