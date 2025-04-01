import type { BuildContext } from "./BuildContext";

/**
 * A Rollup plugin declaration. Manages its import logic and configuration.
 */
export interface Plugin<TName extends string, TConfig, TInstance> {
	readonly name: TName;

	/** @internal */
	readonly factory: PluginFactoryBlock<TConfig, TInstance>;

	/** @internal */
	readonly configure: PluginConfigBlock<TConfig>;

	override(
		configOverride: Partial<TConfig>,
	): Plugin<TName, TConfig, TInstance>;

	override(
		block: PluginConfigOverrideBlock<TConfig>,
	): Plugin<TName, TConfig, TInstance>;
}

export interface PluginFactoryBlock<TConfig, TInstance> {
	(config: TConfig, context: BuildContext): Promise<TInstance> | TInstance;
}

export interface PluginConfigBlock<TConfig> {
	(context: BuildContext): Promise<TConfig> | TConfig;
}

export interface PluginConfigOverrideBlock<TConfig> {
	(config: TConfig, context: BuildContext): Promise<TConfig> | TConfig;
}

export interface PluginFactoryBuilder<TName extends string> {
	/** @internal */
	readonly name: TName;

	factory<TConfig, TInstance>(
		block: PluginFactoryBlock<TConfig, TInstance>,
	): PluginConfigurationBuilder<TName, TConfig, TInstance>;
}

export interface PluginConfigurationBuilder<TName extends string, TConfig, TInstance> {
	/** @internal */
	readonly name: TName;

	/** @internal */
	readonly factory: PluginFactoryBlock<TConfig, TInstance>;

	configure<TConfig>(
		config: TConfig,
	): Plugin<TName, TConfig, TInstance>;

	configure<TConfig>(
		block: PluginConfigBlock<TConfig>
	): Plugin<TName, TConfig, TInstance>;
}

export type NameOf<TPlugin> = (
	TPlugin extends Plugin<infer TName, any, any> ? TName : unknown
);

export type ConfigOf<TPlugin> = (
	TPlugin extends Plugin<any, infer TConfig, any> ? TConfig : unknown
);

export type AnyPlugin = (
	Plugin<any, any, any>
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
	block: PluginFactoryBlock<any, any>
): PluginConfigurationBuilder<any, any, any> {
	return {
		name: this.name,
		factory: block,
		configure: configurePlugin,
	};
}

function configurePlugin(
	this: PluginConfigurationBuilder<any, any, any>,
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
