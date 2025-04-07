import type { BuildContext } from "./BuildContext";

export type Entity<TName extends string, TConfig extends object, TBase = {}> = TBase & {
	readonly name: TName;

	/** @internal */
	isFinal: boolean;

	/** @internal */
	getEnabled: Configurator<boolean>;

	/** @internal */
	getConfig: Configurator<TConfig>;

	/** @internal */
	finalize(): Entity<TName, TConfig, TBase>;

	enable(
		configurator: Configurator<boolean>,
	): Entity<TName, TConfig, TBase>;

	disable(
		configurator?: Configurator<boolean>,
	): Entity<TName, TConfig, TBase>;

	configure(
		configurator?: Configurator<TConfig>,
	): Entity<TName, TConfig, TBase>;
}

export interface Configurator<TConfig> {
	(currentConfig: TConfig | undefined, context: BuildContext): Promise<TConfig | undefined> | TConfig | undefined;
}

export type AnyEntity = (
	Entity<any, any>
);

export type NameOf<TEntity extends AnyEntity> = (
	TEntity extends Entity<infer TName, any, {}> ? TName : string
);

export type ConfigOf<TEntity extends AnyEntity> = (
	TEntity extends Entity<any, infer TConfig, {}> ? TConfig : unknown
);

export function createEntity<TName extends string, TConfig extends object, TBase>(
	name: TName,
	base: TBase,
): Entity<TName, TConfig, TBase> {
	return {
		name,
		isFinal: false,
		getEnabled: defaultGetEnabled,
		getConfig: defaultGetConfig,
		finalize: onFinalize,
		enable: onEnable,
		disable: onDisable,
		configure: onConfigure,
		...base,
	} satisfies Entity<TName, TConfig, {}> as any;
}

function defaultGetEnabled() {
	return true;
}

function defaultGetConfig(config?: any) {
	return config;
}

function onFinalize(
	this: AnyEntity,
): AnyEntity {
	return this.isFinal
		? this
		: {
			...this,
			isFinal: true,
		};
}

function onEnable(
	this: AnyEntity,
	configurator: Configurator<boolean> = defaultGetEnabled,
): AnyEntity {
	const prev = this.getEnabled;
	const next: Configurator<boolean> = async (currentConfig, context) => (
		configurator(await prev(currentConfig, context), context)
	);

	if (this.isFinal) {
		this.getEnabled = next;
		return this;
	}

	return {
		...this,
		getEnabled: next,
	};
}

function onDisable(
	this: AnyEntity,
	configurator: Configurator<boolean> = defaultGetEnabled,
): AnyEntity {
	const prev = this.getEnabled;
	const next: Configurator<boolean> = async (currentConfig, context) => (
		!(await configurator(!(await prev(currentConfig, context)), context))
	);

	if (this.isFinal) {
		this.getEnabled = next;
		return this;
	}

	return {
		...this,
		getEnabled: next,
	};
}

function onConfigure(
	this: AnyEntity,
	configurator: Configurator<any>,
): AnyEntity {
	const prev = this.getConfig;
	const next: Configurator<any> = async (currentConfig, context) => (
		configurator(await prev(currentConfig, context), context)
	);

	if (this.isFinal) {
		this.getConfig = next;
		return this;
	}

	return {
		...this,
		getConfig: next,
	};
}
