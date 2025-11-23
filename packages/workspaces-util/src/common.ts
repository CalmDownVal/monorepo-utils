export interface NodeError extends Error {
	readonly code?: string;
}

export function isENOENT(ex: unknown): ex is NodeError {
	return (ex as NodeError | null)?.code === "ENOENT";
}
