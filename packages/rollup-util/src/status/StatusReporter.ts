import type { GraphNode } from "@calmdownval/workspaces-util";

export interface StatusReporter {
	readonly root: GraphNode;
	log(node: GraphNode, message: string): void;
	update(node: GraphNode, status: StatusInfo): void;
	close(): void;
}

export interface StatusInfo {
	kind: StatusKind;
	message?: string;
	timeMs?: number;
}

export type StatusKind =
	| "FAIL"
	| "BUSY"
	| "IDLE"
	| "PASS"
	| "SKIP";
