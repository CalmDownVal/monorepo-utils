import { spawn } from "node:child_process";
import { EOL } from "node:os";

import { getModule } from "./discovery";
import type { Workspace } from "./types";

export interface CommandError extends Error {
	exitCode?: number | null;
}

export function runCommand(
	command: string,
	args: readonly string[] = [],
	cwd: string = process.cwd(),
): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, args, {
			cwd,
			stdio: 'inherit',
		});

		proc.on('error', reject);
		proc.on('exit', code => {
			if (code === 0) {
				resolve();
			}
			else {
				const error = new Error(`Command failed with exit code ${code}.`);
				(error as CommandError).exitCode = code;

				reject(error);
			}
		});
	});
}

export interface WorkspaceCommandOptions {
	readonly workspace: Workspace;
	readonly moduleName: string;
	readonly command: string;
	readonly args?: readonly string[];
}

export async function runWorkspaceCommand(options: WorkspaceCommandOptions): Promise<void>;
export async function runWorkspaceCommand({ workspace, moduleName, command, args }: WorkspaceCommandOptions) {
	const line0 = moduleName;
	const line1 = `$ ${command} ${args?.join(" ") ?? ""}`;

	println(`[1;97m${line0}\u001b[0m`);
	println(line1);
	println("─".repeat(Math.min(Math.max(line0.length, line1.length), 80)));

	const module = getModule(workspace, moduleName);
	await runCommand(command, args, module.baseDir);

	println();
}

export function print(message: string) {
	process.stdout.write(message);
}

export function println(message?: string) {
	message && print(message);
	print(EOL);
}
