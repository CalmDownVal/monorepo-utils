import type { PluginImpl } from "rollup";

import type { BuildContext } from "./BuildContext";
import { createEntity, type Entity } from "./Entity";

export interface PluginDeclaration<TName extends string, TConfig extends object> extends Entity<TName, TConfig> {
	/** @internal */
	readonly loadPlugin: PluginLoader<TConfig>;
}

export interface PluginLoader<TConfig extends object> {
	(context: BuildContext): Promise<PluginImpl<TConfig>>;
}

export type AnyPluginDeclaration = (
	PluginDeclaration<any, any>
);

export function declarePlugin<TName extends string, TConfig extends object>(
	name: TName,
	loadPlugin: PluginLoader<TConfig>,
): PluginDeclaration<TName, TConfig> {
	return createEntity(name, { loadPlugin });
}
