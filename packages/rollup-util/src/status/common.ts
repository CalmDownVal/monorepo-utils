import { EOL } from "node:os";

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
