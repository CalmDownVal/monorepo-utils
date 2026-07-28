import * as FS from "node:fs/promises";
import * as Path from "node:path";

import * as YAML from "yaml";

const root = Path.join(import.meta.dirname, "../..");
const lockFileStr = await FS.readFile(Path.join(root, "pnpm-lock.yaml"), "utf8");

const lockfile = YAML.parse(lockFileStr);
const packages = lockfile.packages || {};

const versions = {};

Object.keys(packages).forEach(key => {
	const lastAt = key.lastIndexOf("@");
	const name = key.slice(0, lastAt);
	const version = key.slice(lastAt + 1);

	if (!versions[name]) {
		versions[name] = new Set();
	}

	versions[name].add(version);
});

let countMultiple = 0;

Object.entries(versions)
	.filter(([_, vers]) => vers.size > 1)
	.sort((a, b) => b[1].size - a[1].size)
	.forEach(([pkg, vers]) => {
		countMultiple += 1;
		console.log(`${pkg}:\n  "${Array.from(vers).join('", "')}" (${vers.size})`);
	});

if (countMultiple > 0) {
	console.log(`\n\n${countMultiple} packages install more than one version.`);
}
else {
	console.log("All good!");
}
