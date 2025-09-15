import type { GraphNode, Module } from "@calmdownval/workspaces-util";

export interface StatusReporter {
	readonly lineCount: number;
	readonly root: GraphNode;
	lastLogNode?: GraphNode;

	clear(): void;
	log(node: GraphNode, message: string): void;
	update(node: GraphNode, status: StatusInfo): void;
}

export interface StatusInfo {
	kind: StatusKind;
	message?: string;
	timeMs?: number;
}

export type StatusKind =
	| "error"
	| "pending"
	| "queued"
	| "success"
	| "skipped"
	| "unknown";

interface StatusNode extends GraphNode {
	readonly module: Module;
	readonly dependencies: StatusNode[];
	status?: StatusInfo;
}

export function createStatusReporter(root: GraphNode, defaultStatus: StatusKind = "unknown"): StatusReporter {
	const visit = (node: StatusNode) => {
		node.status = { kind: defaultStatus };
		node.dependencies.forEach(visit);
	};

	visit(root);

	const format = formatStatusTree(root);
	print("\n");
	print(format.output);

	return {
		lineCount: format.lineCount,
		root,
		clear: onClear,
		log: onLog,
		update: onUpdate,
	};
}

function onClear(this: StatusReporter) {
	print(`\u001b[${this.lineCount + 1}A\r\u001b[0J`);
}

function onLog(this: StatusReporter, node: GraphNode, message: string) {
	this.clear();
	if (this.lastLogNode !== node) {
		const header = node.module.declaration.name;
		print(`\n\u001b[1m${header}\u001b[0m\n┌${"─".repeat(header.length - 1)}\n`);

		this.lastLogNode = node;
	}

	print("│ ")
	print(message.replaceAll(/\r?\n/g, "\n│ "));

	print("\n\n");
	print(formatStatusTree(this.root).output);
}

function onUpdate(this: StatusReporter, node: GraphNode, status: StatusInfo) {
	(node as StatusNode).status = status;

	this.clear();
	print("\n");
	print(formatStatusTree(this.root).output);
}


const Icon: Record<StatusKind, string> = {
	error:   color("FAIL", "0;31m"),
	pending: color("BUSY", "0;36m"),
	queued:  color("IDLE", "0;33m"),
	success: color("PASS", "0;32m"),
	skipped: color("SKIP", "0;33m"),
	unknown: color("????", "0;33m"),
};

function color(text: string, color: string) {
	return `\u001b[${color}${text}\u001b[0m`;
}

function formatStatusTree(
	node: StatusNode,
	prefix: string = "",
	li0: string = "",
	li1: string = "",
) {
	const { length } = node.dependencies;
	const branch = prefix + li0;
	const name = node.module.declaration.name;

	let icon = Icon.unknown;
	let status = "";
	if (node.status) {
		icon = Icon[node.status.kind];

		if (node.status.message) {
			status += ` · ${node.status.message}`;
		}

		if (node.status.timeMs !== undefined) {
			status += ` (${formatTime(node.status.timeMs)})`;
		}
	}

	let lineCount = 1;
	let output = `${icon} \u001b[0;90m${branch}\u001b[0m\u001b[1m${name}\u001b[0m${status}\n`;
	let index = 0;
	let isLast;
	let result;

	for (; index < length; index += 1) {
		isLast = index + 1 === length;
		result = formatStatusTree(
			node.dependencies[index],
			prefix + li1,
			isLast ? "└─ " : "├─ ",
			isLast ? "   " : "│  ",
		);

		lineCount += result.lineCount;
		output += result.output;
	}

	return {
		lineCount,
		output,
	};
}

export function print(message: string) {
	process.stdout.write(message, "utf8");
}

export function formatTime(timeMs: number): string {
	if (timeMs >= 1_000) {
		return `${(Math.round(timeMs / 100) / 10).toFixed(1)}s`;
	}

	return `${timeMs.toFixed(0)}ms`;
}
