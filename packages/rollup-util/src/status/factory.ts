import { EOL } from "node:os";

import type { GraphNode } from "@calmdownval/workspaces-util";

import type { StatusInfo, StatusKind, StatusReporter } from "./StatusReporter";
import { formatTime, print, println } from "./common";

type StatusReporterExt = StatusReporter & {
	readonly ci: boolean;
	readonly status: WeakMap<GraphNode, StatusInfo>;
	lineCount: number;
	lastLogNode?: GraphNode;

	ansi: (text: string, code: string) => string
	clear: () => void
	printTree: () => void
};

export function createStatusReporter(root: GraphNode): StatusReporter {
	const ci = /^(true|1)$/i.test(process.env.CI ?? "");
	const reporter: StatusReporterExt = {
		ci,
		status: new WeakMap(),
		root,
		lineCount: 0,
		ansi: ci
			? (text) => text
			: (text, code) => `\u001b[${code}${text}\u001b[0m`,

		log: onLog,
		update: onUpdate,
		clear: onClear,
		close: onClose,
		printTree: onPrintTree,
	};

	if (!ci) {
		reporter.printTree();
	}

	return reporter;
}


const ANSI_RED = "0;31m";
const ANSI_GREEN = "0;32m";
const ANSI_CYAN = "0;36m";
const ANSI_YELLOW = "0;33m";
const ANSI_HI_BLACK = "0;90m";
const ANSI_BOLD = "1m";

const StatusColor: Record<StatusKind, string> = {
	FAIL: ANSI_RED,
	BUSY: ANSI_CYAN,
	IDLE: ANSI_YELLOW,
	PASS: ANSI_GREEN,
	SKIP: ANSI_YELLOW,
};

function onClear(this: StatusReporterExt) {
	if (!this.ci && this.lineCount > 0) {
		print(`\u001b[${this.lineCount + 1}A\r\u001b[0J`);
	}
}

function onClose(this: StatusReporterExt) {
	if (this.ci) {
		this.printTree();
	}
}

function onLog(this: StatusReporterExt, node: GraphNode, message: string) {
	this.clear();
	if (this.lastLogNode !== node) {
		const header = node.module.declaration.name;
		println(`${EOL}${this.ansi(header, ANSI_BOLD)}${EOL}┌${"─".repeat(header.length - 1)}`);

		this.lastLogNode = node;
	}

	print("│ ")
	print(message.replaceAll(/(\r\n|\n|\r)/g, `${EOL}│ `));

	if (!this.ci) {
		println();
		this.printTree();
	}
}

function onUpdate(this: StatusReporterExt, node: GraphNode, status: StatusInfo) {
	this.status.set(node, status);
	if (!this.ci) {
		this.clear();
		this.printTree();
	}
}

function onPrintTree(
	this: StatusReporterExt,
	node: GraphNode = this.root,
	prefix: string = "",
	li0: string = "",
	li1: string = "",
) {
	const status = this.status.get(node);
	let label = this.ansi("IDLE", StatusColor.IDLE);
	let info = "";

	if (status) {
		label = this.ansi(status.kind, StatusColor[status.kind]);

		if (status.message) {
			info += ` · ${status.message}`;
		}

		if (status.timeMs !== undefined) {
			info += ` (${formatTime(status.timeMs)})`;
		}
	}

	const { length } = node.dependencies;
	let index = 0;
	let isLast;
	let result;

	let lineCount = 1;
	let output = `${label} ${this.ansi(prefix + li0, ANSI_HI_BLACK)}${this.ansi(node.module.declaration.name, ANSI_BOLD)}${info}${EOL}`;

	for (; index < length; index += 1) {
		isLast = index + 1 === length;
		result = onPrintTree.call(
			this,
			node.dependencies[index],
			prefix + li1,
			isLast ? "└─ " : "├─ ",
			isLast ? "   " : "│  ",
		);

		lineCount += result.lineCount;
		output += result.output;
	}

	if (node === this.root) {
		this.lineCount = lineCount;
		println();
		print(output);
		return null!;
	}

	return {
		lineCount,
		output,
	};
}
