import type { Plugin as RollupPlugin } from "rollup";

import type { BuildContext } from "./BuildContext";

/**
 * A Rollup plugin declaration. Manages its import logic and configuration.
 */
export interface Plugin<TName extends string, TConfig> {
	readonly name: TName;

	/** @internal */
	readonly factory: PluginFactoryBlock<TConfig>;

	/** @internal */
	readonly configure: PluginConfigBlock<TConfig>;

	override(
		configOverride: Partial<TConfig>,
	): Plugin<TName, TConfig>;

	override(
		block: PluginConfigOverrideBlock<TConfig>,
	): Plugin<TName, TConfig>;
}

export interface PluginFactoryBlock<TConfig> {
	(context: BuildContext): Promise<PluginFactory<TConfig>> | PluginFactory<TConfig>;
}

export interface PluginConfigBlock<TConfig> {
	(context: BuildContext): Promise<TConfig> | TConfig;
}

export interface PluginConfigOverrideBlock<TConfig> {
	(config: TConfig, context: BuildContext): Promise<TConfig> | TConfig;
}

export interface PluginFactory<TConfig> {
	(config: TConfig): RollupPlugin;
}

export interface PluginFactoryBuilder<TName extends string> {
	/** @internal */
	readonly name: TName;

	factory<TConfig>(
		block: PluginFactoryBlock<TConfig>,
	): PluginConfigurationBuilder<TName, TConfig>;
}

export interface PluginConfigurationBuilder<TName extends string, TConfig> {
	/** @internal */
	readonly name: TName;

	/** @internal */
	readonly factory: PluginFactoryBlock<TConfig>;

	configure(
		config: TConfig,
	): Plugin<TName, TConfig>;

	configure(
		block: PluginConfigBlock<TConfig>
	): Plugin<TName, TConfig>;
}

export type NameOf<TPlugin> = (
	TPlugin extends Plugin<infer TName, any> ? TName : unknown
);

export type ConfigOf<TPlugin> = (
	TPlugin extends Plugin<any, infer TConfig> ? TConfig : unknown
);

export type AnyPlugin = (
	Plugin<any, any>
);

export type PluginMap = {
	[TPluginName in string]: AnyPlugin;
};

export function declarePlugin<TName extends string>(name: TName): PluginFactoryBuilder<TName> {
	return {
		name,
		factory: setPluginFactory,
	};
}

function setPluginFactory(
	this: PluginFactoryBuilder<any>,
	block: PluginFactoryBlock<any>
): PluginConfigurationBuilder<any, any> {
	return {
		name: this.name,
		factory: block,
		configure: configurePlugin,
	};
}

function configurePlugin(
	this: PluginConfigurationBuilder<any, any>,
	configOrBlock: any,
): AnyPlugin {
	return {
		name: this.name,
		factory: this.factory,
		override: overridePluginConfig,
		configure: typeof configOrBlock === 'function'
			? configOrBlock
			: () => configOrBlock,
	};
}

function overridePluginConfig(
	this: AnyPlugin,
	configOrBlock: any,
): AnyPlugin {
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
