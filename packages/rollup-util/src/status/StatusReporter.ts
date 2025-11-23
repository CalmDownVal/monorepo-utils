import type { GraphNode } from "@calmdownval/workspaces-util";
import type { LogLevel as RollupLogLevel } from "rollup";

export interface StatusReporter {
	readonly root: GraphNode;
	log(node: GraphNode, message: string, level?: LogLevel): void;
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

export type LogLevel = RollupLogLevel | "error";
