import { readdir, stat } from "node:fs";
import { join, resolve, sep } from "node:path";

import { isENOENT } from "./common";

export interface GlobOptions {
	/**
	 * The directory where the glob resolution begins.
	 *
	 * Defaults to the current working directory.
	 */
	readonly cwd?: string;

	/**
	 * Limits the number of concurrent file system calls.
	 *
	 * Defaults to 16.
	 */
	readonly maxConcurrency?: number;
}

export function resolveGlob(
	pattern: string,
	options?: GlobOptions,
): Promise<string[]> {
	return new Promise<string[]>((onResolve, onReject) => {
		const maxConcurrency = Math.max(1, options?.maxConcurrency ?? 16);
		const glob = parseGlob(pattern);
		const results: string[] = [];
		const stack: GlobMatch[] = [
			{
				index: 0,
				path: options?.cwd ? resolve(options.cwd) : process.cwd(),
			}
		];

		let concurrency = 1;
		const next = (ex?: Error | null) => {
			if (ex && !isENOENT(ex)) {
				onReject(ex);
				return;
			}

			concurrency -= 1;
			while (concurrency < maxConcurrency && stack.length > 0) {
				const pointer = stack.pop()!;
				if (pointer.index === glob.length) {
					results.push(pointer.path);
					continue;
				}

				concurrency += 1;

				const nextIndex = pointer.index + 1;
				glob[pointer.index].resolve(
					stack,
					join(pointer.path, sep),
					nextIndex,
					nextIndex === glob.length,
					next,
				);
			}

			if (concurrency === 0 && stack.length === 0) {
				onResolve(results);
			}
		};

		next();
	});
}


const CC_SEP_POSIX   = 0x2f; // '/' forward slash
const CC_SEP_WINDOWS = 0x5c; // '\' backward slash
const CC_WILD_SINGLE = 0x3f; // '?' question mark
const CC_WILD_MANY   = 0x2a; // '*' asterisk
const CC_WILD_GROUP  = 0x5b; // '[' left square bracket

function parseGlob(pattern: string): GlobSegment[] {
	const { length } = pattern;
	const glob: GlobSegment[] = [];

	let index = 0;
	let cc;
	let hasWildcards = false;
	let anchor = 0;
	let parts: string[] = [];

	const endOfSegment = () => {
		if (index > anchor) {
			parts.push(pattern.slice(anchor, index));
		}

		if (hasWildcards) {
			glob.push({
				pattern: parts,
				resolve: resolveWildcardSegment,
			});

			parts = [];
		}
		else if (parts.length > 0) {
			glob.push({
				segment: parts[0],
				resolve: resolveStaticSegment,
			});

			parts.length = 0;
		}

		hasWildcards = false;
		anchor = index === 0 ? 0 : index + 1; // preserve initial separator, if present
	};

	for (; index < length; index += 1) {
		cc = pattern.charCodeAt(index);
		switch (cc) {
			case CC_SEP_POSIX:
			case CC_SEP_WINDOWS:
				endOfSegment();
				break;

			case CC_WILD_MANY:
				if (pattern.charCodeAt(index - 1) === CC_WILD_MANY) {
					throw new Error("Recursive wildcard (**) is not supported.");
				}

				// fall through

			case CC_WILD_SINGLE:
				if (index > anchor) {
					parts.push(pattern.slice(anchor, index));
				}

				parts.push(pattern[index]);
				hasWildcards = true;
				anchor = index + 1;
				break;

			case CC_WILD_GROUP:
				throw new Error("Group wildcards (e.g. [abc]) are not supported.");
		}
	}

	endOfSegment();
	return glob;
}

function resolveStaticSegment(
	this: StaticGlobSegment,
	globStack: GlobMatch[],
	basePath: string,
	nextIndex: number,
	isLast: boolean,
	next: (ex?: Error | null) => void,
) {
	const path = join(basePath, this.segment);
	stat(path, (ex, info) => {
		if (ex) {
			next(ex);
			return;
		}

		if (isLast || info.isDirectory()) {
			globStack.push({
				index: nextIndex,
				path,
			});
		}

		next();
	});
}

const readDirOptions = {
	withFileTypes: true,
	recursive: false,
} as const;

function resolveWildcardSegment(
	this: WildcardGlobSegment,
	globStack: GlobMatch[],
	basePath: string,
	nextIndex: number,
	isLast: boolean,
	next: (ex?: Error | null) => void,
) {
	readdir(basePath, readDirOptions, (ex, entries) => {
		if (ex) {
			next(ex);
			return;
		}

		const { length } = entries;
		let index = 0;
		let entry;

		for (; index < length; index += 1) {
			entry = entries[index];
			if ((isLast || entry.isDirectory()) && matchesPattern(this.pattern, entry.name)) {
				globStack.push({
					index: nextIndex,
					path: join(basePath, entry.name),
				});
			}
		}

		next();
	});
}

const WILD_SINGLE = '?';
const WILD_MANY = '*';

function matchesPattern(pattern: readonly string[], input: string): boolean {
	const patternLength = pattern.length;
	const inputLength = input.length;
	const stack: PatternMatch[] = [
		{
			index: 0,
			offset: 0,
		}
	];

	let match;
	let segment;
	do {
		match = stack.pop()!;
		if (match.index === patternLength && match.offset === inputLength) {
			return true;
		}

		switch (segment = pattern[match.index]) {
			case WILD_SINGLE:
				// match any one character - if present, simply move forward
				if (match.offset < inputLength) {
					match.index += 1;
					match.offset += 1;
					stack.push(match);
				}

				break;

			case WILD_MANY: {
				const next = match.index + 1;

				// no more segments after this one, it's a match!
				if (next === patternLength) {
					return true;
				}

				// peek ahead for a static segment
				if ((segment = pattern[next]) !== WILD_SINGLE && segment !== WILD_MANY) {
					// if found, only create matches for places where the first character is seen
					const cc = segment.charCodeAt(0);

					let index = match.offset;
					for (; index < inputLength; index += 1) {
						if (input.charCodeAt(index) === cc) {
							stack.push({
								index: next,
								offset: index,
							});
						}
					}
				}

				// bad glob... create matches for every possibility :(
				let index = match.offset;
				for (; index < inputLength; index += 1) {
					stack.push({
						index: next,
						offset: index,
					});
				}

				break;
			}

			default:
				// check the searched segment exists at the current offset
				if (input.startsWith(segment, match.offset)) {
					match.index += 1;
					match.offset += segment.length;
					stack.push(match);
				}

				break;
		}
	}
	while (stack.length > 0);

	return false;
}


interface GlobMatch {
	index: number;
	path: string;
}

interface PatternMatch {
	index: number;
	offset: number;
}

interface GlobSegmentBase {
	resolve(
		globStack: GlobMatch[],
		basePath: string,
		nextIndex: number,
		isLast: boolean,
		next: (ex?: Error | null) => void,
	): void;
}

interface StaticGlobSegment extends GlobSegmentBase {
	readonly segment: string;
}

interface WildcardGlobSegment extends GlobSegmentBase {
	readonly pattern: readonly string[];
}

type GlobSegment =
	| StaticGlobSegment
	| WildcardGlobSegment;
