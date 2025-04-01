import { rollup, type OutputOptions as TargetConfig } from "rollup";

import type { AnyPlugin, ConfigOf, NameOf, PluginConfigOverrideBlock, PluginMap } from "./Plugin";
import { getContext, type BuildContext } from "./BuildContext";

export interface Target<TName extends string, TPlugins extends PluginMap> {
	readonly name: TName;

	/** @internal */
	readonly entries: { readonly [TEntry in string]: string };

	/** @internal */
	readonly plugins: readonly AnyPlugin[];

	/** @internal */
	readonly configure: TargetConfigBlock;

	build(): Promise<void>;

	entry(
		unit: string,
		entryPath: string,
	): Target<TName, TPlugins>;

	overridePlugin<TPluginName extends keyof TPlugins>(
		plugin: TPluginName,
		configOverride: Partial<ConfigOf<TPlugins[TPluginName]>>,
	): Target<TName, TPlugins>;

	overridePlugin<TPluginName extends keyof TPlugins>(
		plugin: TPluginName,
		block: PluginConfigOverrideBlock<ConfigOf<TPlugins[TPluginName]>>,
	): Target<TName, TPlugins>;

	overrideOutput(
		configOverride: Partial<TargetConfig>,
	): Target<TName, TPlugins>;

	overrideOutput(
		block: TargetConfigOverrideBlock,
	): Target<TName, TPlugins>;
}

export interface TargetConfigBlock {
	(context: BuildContext): Promise<TargetConfig> | TargetConfig;
}

export interface TargetConfigOverrideBlock {
	(config: TargetConfig, context: BuildContext): Promise<TargetConfig> | TargetConfig;
}

export interface TargetBuilder<TName extends string, TPlugins extends PluginMap> {
	/** @internal */
	readonly name: TName;

	/** @internal */
	readonly plugins: readonly AnyPlugin[];

	plugin<TPlugin extends AnyPlugin>(
		plugin: TPlugin,
	): TargetBuilder<TName, TPlugins & { [K in NameOf<TPlugin>]: TPlugin }>;

	configure(
		config: TargetConfig,
	): Target<TName, TPlugins>;

	configure(
		block: TargetConfigBlock,
	): Target<TName, TPlugins>;
}

export function declareTarget<TName extends string>(name: TName): TargetBuilder<TName, {}> {
	return {
		name,
		plugins: [],
		plugin: addPlugin,
		configure: configureTarget,
	};
}

function addPlugin(
	this: TargetBuilder<any, any>,
	plugin: AnyPlugin,
): TargetBuilder<any, any> {
	return {
		...this,
		plugins: [ ...this.plugins, plugin ],
	};
}

function configureTarget(
	this: TargetBuilder<any, any>,
	configOrBlock: TargetConfig | TargetConfigBlock,
): Target<any, any> {
	return {
		name: this.name,
		entries: {},
		plugins: this.plugins,
		build: buildTarget,
		entry: addTargetEntry,
		overridePlugin: overridePluginConfig,
		overrideOutput: overrideOutputConfig,
		configure: typeof configOrBlock === 'function'
			? configOrBlock
			: () => configOrBlock,
	};
}

async function buildTarget(
	this: Target<any, any>,
) {
	const context = getContext();
	process.chdir(context.cwd);

	const bundle = await rollup({
		input: this.entries,
		plugins: Promise.all(this.plugins.map(async it => {
			const pluginConfig = await it.configure(context);
			const instance = await it.factory(pluginConfig, context);
			return instance;
		}))
	});

	const outputConfig = await this.configure(context);
	bundle.write(outputConfig);
}

function addTargetEntry(
	this: Target<any, any>,
	unit: string,
	entryPath: string,
): Target<any, any> {
	return {
		...this,
		entries: {
			...this.entries,
			[unit]: entryPath,
		},
	};
}

function overridePluginConfig(
	this: Target<any, any>,
	pluginName: string,
	configOrBlock: any,
): Target<any, any> {
	return {
		...this,
		plugins: this.plugins.map(plugin => (
			plugin.name === pluginName
				? plugin.override(configOrBlock)
				: plugin
		)),
	};
}

function overrideOutputConfig(
	this: Target<any, any>,
	configOrBlock: any,
): Target<any, any> {
	return {
		...this,
		configure: async context => {
			const config = await this.configure(context);
			Object.assign(config, (
				typeof configOrBlock === 'function'
					? await configOrBlock(config, context)
					: configOrBlock
			));

			return config;
		},
	};
}
