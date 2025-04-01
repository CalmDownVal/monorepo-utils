import pluginTerser from "@rollup/plugin-terser";
import pluginTypeScript from "@rollup/plugin-typescript";
import pluginDelete from "rollup-plugin-delete";
import pluginDefinitions from "rollup-plugin-dts";
import { nodeExternals as pluginNodeExternals } from "rollup-plugin-node-externals";

// eslint-disable-next-line import/no-default-export
export default [
	{
		input: "./src/index.ts",
		output: {
			file: "./dist/index.mjs",
			format: "es",
			sourcemap: true,
		},
		plugins: [
			pluginDelete({
				runOnce: true,
				targets: "./dist/*",
			}),
			pluginNodeExternals(),
			pluginTypeScript(),
			pluginTerser({
				output: {
					comments: false,
				},
			}),
		],
	},
	{
		input: "./src/index.ts",
		output: {
			file: "./dist/index.d.ts",
			format: "es",
			sourcemap: false,
		},
		plugins: [
			pluginDefinitions(),
		],
	},
];
