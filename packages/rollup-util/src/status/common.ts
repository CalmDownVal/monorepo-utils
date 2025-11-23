import { EOL } from "node:os";

import type { GraphNode } from "@calmdownval/workspaces-util";

import type { LogLevel, StatusReporter } from "./StatusReporter";

export function print(message: string) {
	process.stdout.write(message, "utf8");
}

export function println(message = "") {
	print(message + EOL);
}

export function formatTime(timeMs: number): string {
	if (timeMs >= 1_000) {
		return `${(Math.round(timeMs / 100) / 10).toFixed(1)}s`;
	}

	return `${timeMs.toFixed(0)}ms`;
}


const ConsoleNode = {
	module: {
		package: {
			name: "Console",
		},
	},
} as GraphNode;

function jsonReplacer(_key: string, value: unknown) {
	switch (typeof value) {
		case "bigint":
			return value.toString() + "n";

		case "symbol":
		case "function":
			return undefined;

		default:
			return value;
	}
}

function stringifyConsoleArg(value: unknown) {
	switch (typeof value) {
		case "undefined":
			return "undefined";

		case "object":
			if (value === null) {
				return "null";
			}

			if (value instanceof Error) {
				return value.stack ?? value.toString();
			}

			return JSON.stringify(value, jsonReplacer, 2);

		case "function":
			return "[function]";

		default:
			return (value as string | number | boolean | bigint | symbol ).toString();
	}
}

export function overrideConsole(reporter: StatusReporter) {
	const proxy = (level: LogLevel) => (...args: string[]) => {
		reporter.log(ConsoleNode, args.map(stringifyConsoleArg).join(" "), level);
	};

	console.trace = proxy("debug");
	console.debug = proxy("debug");
	console.log = proxy("info");
	console.info = proxy("info");
	console.warn = proxy("warn");
	console.error = proxy("error");
}
