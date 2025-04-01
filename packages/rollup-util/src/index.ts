export {
	build,
	type BuildContext,
	type TargetEnv,
} from "./BuildContext";

export {
	declarePlugin,
	type Plugin,
	type PluginFactoryBlock,
	type PluginConfigBlock,
	type PluginConfigOverrideBlock,
	type PluginFactoryBuilder,
	type PluginConfigurationBuilder,
	type NameOf,
	type ConfigOf,
	type AnyPlugin,
	type PluginMap,
} from "./Plugin";

export {
	declareTarget,
	type Target,
	type TargetConfigBlock,
	type TargetConfigOverrideBlock,
	type TargetBuilder,
} from "./Target";
