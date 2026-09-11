import * as FS from "node:fs/promises";
import * as Path from "node:path";

const PLUGIN_NAME = "Delete";

/**
 * @typedef {Object} DeletePluginTarget
 * @property {string|string[]} include glob pattern(s) of files to include
 * @property {string|string[]} [exclude] glob pattern(s) to exclude (optional)
 * @property {"before"|"after"} [trigger="before"] when to run the operation (defaults to "before")
 */

/**
 * @typedef {Object} DeletePluginOptions
 * @property {(string|DeletePluginTarget)|(string|DeletePluginTarget)[]} targets desired delete operations
 * @property {boolean} [dryRun=false] whether to perform a dry run, only logging actions without executing them (defaults to false)
 * @property {boolean} [runOnce=true] when in watch mode, controls whether to only execute targets on the first build (defaults to true)
 * @property {boolean} [autoClean=false] when in watch mode, controls whether to automatically delete files left over from previous builds - never touches files that weren't emitted by the build pipeline (defaults to false)
 */

/**
 * @param {DeletePluginOptions} pluginOptions
 */
export default function DeletePlugin(pluginOptions) {
	const targets = toArray(pluginOptions?.targets ?? []).map(it => typeof it === "string" ? { include: it } : it);
	const runOnce = pluginOptions?.runOnce ?? true;
	const autoClean = pluginOptions?.autoClean ?? false;

	const exec = (context, message, block) => {
		if (pluginOptions?.dryRun) {
			message && context.info({
				plugin: PLUGIN_NAME,
				pluginCode: "DRY_RUN",
				message,
			});

			return;
		}

		return block();
	};

	const execTarget = async (context, cwd, target) => {
		const include = toArray(target.include);
		const globOptions = {
			cwd,
			exclude: toArray(target.exclude ?? []),
			withFileTypes: true,
		};

		const entries = [];
		for (const includePattern of include) {
			for await (const entry of FS.glob(includePattern, globOptions)) {
				entries.push(entry);
			}
		}

		entries.sort(directoriesLast);
		for (const entry of entries) {
			const entryPath = Path.join(entry.parentPath, entry.name);
			if (entry.isFile()) {
				await exec(context, `would delete file ${entryPath}`, () => FS.unlink(entryPath));
			}
			else if (entry.isSymbolicLink()) {
				await exec(context, `would delete symlink ${entryPath}`, () => FS.unlink(entryPath));
			}
			else if (entry.isDirectory()) {
				try {
					await exec(context, `would delete directory ${entryPath}`, () => FS.rmdir(entryPath));
				}
				catch (ex) {
					// ignore errors when directory is not empty
					if (ex?.code !== "ENOTEMPTY") {
						throw ex;
					}
				}
			}
		}
	};

	let isFirstBeforeRun = true;
	let isFirstAfterRun = true;
	let previousBuildFiles = null;
	let currentBuildFiles = null;

	return {
		name: PLUGIN_NAME,
		async buildStart() {
			if (runOnce && !isFirstBeforeRun) {
				return;
			}

			isFirstBeforeRun = false;

			const cwd = process.cwd();
			for (const target of targets) {
				const { trigger } = target;
				if (trigger === "before" || trigger === undefined) {
					await execTarget(this, cwd, target);
				}
			}
		},
		writeBundle(options, bundle) {
			if (!options.dir) {
				return;
			}

			const outDir = Path.resolve(options.dir);

			previousBuildFiles = currentBuildFiles;
			currentBuildFiles = new Set();

			Object.keys(bundle).forEach(fileName => {
				currentBuildFiles.add(Path.resolve(outDir, fileName));
			});
		},
		async closeBundle() {
			if (!runOnce || isFirstAfterRun) {
				isFirstAfterRun = false;

				const cwd = process.cwd();
				for (const target of targets) {
					if (target.trigger === "after") {
						await execTarget(this, cwd, target);
					}
				}
			}

			if (autoClean && previousBuildFiles && currentBuildFiles) {
				const staleFiles = previousBuildFiles.difference(currentBuildFiles);
				for (const staleFile of staleFiles) {
					await exec(this, `would delete stale file ${staleFile}`, () => FS.unlink(staleFile));
				}
			}
		},
	};
}

function toArray(oneOrMore) {
	return Array.isArray(oneOrMore) ? oneOrMore : [ oneOrMore ];
}

function directoriesLast(a, b) {
	// delete files first
	if (a.isDirectory()) {
		if (!b.isDirectory()) {
			return 1;
		}
	}
	else if (b.isDirectory()) {
		return -1;
	}

	// delete directories last, upwards
	return b.parentPath.length - a.parentPath.length;
}
