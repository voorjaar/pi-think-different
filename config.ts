/**
 * Configuration for pi-think-different.
 *
 * Pure functions: no Pi imports, no fs, so it is unit-testable and the extension
 * only has to read the config files and hand their contents here.
 *
 * Layering (later wins):
 *   built-in defaults
 *     <  <extension>/config.json                the extension author's defaults
 *     <  <agentDir>/pi-think-different.json     your defaults for every project
 *     <  <cwd>/.pi/pi-think-different.json      per-project override
 *     <  --think flag
 *     <  /think during the session
 *
 * `agentDir` is Pi's config directory: $PI_CODING_AGENT_DIR, else ~/.pi/agent.
 */

import { join } from "node:path";

import { isIntensity, type Intensity } from "./paradigms.ts";

export type Language = "en" | "zh";
export type Placement = "answer" | "thinking";

/** A paradigm id/alias, or one of the mode keywords. */
export type DefaultSelection = string;

export interface ThinkConfig {
	/** What to start a session with: a paradigm id/alias, "auto", or "off". */
	startup: DefaultSelection;
	intensity: Intensity;
	/** Where the paradigm's fine-grained structure belongs. */
	placement: Placement;
	/** Language for menus, help, status, and notifications. */
	language: Language;
}

export const DEFAULT_CONFIG: ThinkConfig = {
	startup: "off",
	intensity: "standard",
	placement: "answer",
	language: "en",
};

export const PLACEMENTS: Placement[] = ["answer", "thinking"];
export const LANGUAGES: Language[] = ["en", "zh"];

const LANGUAGE_TOKENS: Record<string, Language> = {
	en: "en",
	english: "en",
	"en-us": "en",
	"en_us": "en",
	英文: "en",
	zh: "zh",
	"zh-cn": "zh",
	"zh_cn": "zh",
	"zh-hans": "zh",
	cn: "zh",
	chinese: "zh",
	中文: "zh",
	简体中文: "zh",
};

/** Accept the spellings users actually type. */
export function normalizeLanguage(value: unknown): Language | undefined {
	if (typeof value !== "string") return undefined;
	const token = value.trim().toLowerCase();
	return LANGUAGE_TOKENS[token];
}

export function isLanguage(value: unknown): value is Language {
	return normalizeLanguage(value) !== undefined;
}

export function isPlacement(value: unknown): value is Placement {
	return typeof value === "string" && (PLACEMENTS as string[]).includes(value.toLowerCase());
}

interface ParseReport {
	config: Partial<ThinkConfig>;
	problems: string[];
}

/**
 * Validate one config object. Unknown keys are reported and ignored; a bad value is
 * reported and the rest of that file still applies, so one typo does not disable the extension.
 */
export function parseConfig(raw: unknown): ParseReport {
	const config: Partial<ThinkConfig> = {};
	const problems: string[] = [];

	if (raw === null || raw === undefined || raw === "") return { config, problems };
	if (typeof raw !== "object" || Array.isArray(raw)) {
		return { config, problems: ["config must be a JSON object"] };
	}

	const record = raw as Record<string, unknown>;

	for (const key of Object.keys(record)) {
		if (!["startup", "paradigm", "intensity", "placement", "language"].includes(key)) {
			problems.push(`unknown key '${key}'`);
		}
	}

	// `paradigm` is accepted as a friendlier alias for `startup`.
	const startup = record.startup ?? record.paradigm;
	if (startup !== undefined) {
		if (typeof startup === "string" && startup.trim()) {
			config.startup = startup.trim();
		} else {
			problems.push("startup must be a paradigm name, 'auto', or 'off'");
		}
	}

	if (record.intensity !== undefined) {
		const intensity = record.intensity;
		if (typeof intensity === "string" && isIntensity(intensity)) config.intensity = intensity;
		else problems.push("intensity must be light, standard, or deep");
	}

	if (record.placement !== undefined) {
		if (isPlacement(record.placement)) config.placement = record.placement.toLowerCase() as Placement;
		else problems.push("placement must be 'answer' or 'thinking'");
	}

	if (record.language !== undefined) {
		const language = normalizeLanguage(record.language);
		if (language) config.language = language;
		else problems.push("language must be 'en' or 'zh'");
	}

	return { config, problems };
}

/** Merge partial configs in increasing precedence order. */
export function mergeConfigs(layers: Partial<ThinkConfig>[]): ThinkConfig {
	return layers.reduce<ThinkConfig>((acc, layer) => ({ ...acc, ...layer }), { ...DEFAULT_CONFIG });
}

/**
 * Parse a config file body. JSON with `//` and `/* *​/` comments is accepted because users edit
 * this by hand; comment stripping is string-aware so a URL in a value survives.
 */
export function parseConfigText(text: string): ParseReport {
	try {
		return parseConfig(JSON.parse(stripJsonComments(text)));
	} catch (error) {
		return { config: {}, problems: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
	}
}

export function stripJsonComments(text: string): string {
	let out = "";
	let inString = false;
	let inEscape = false;
	let inBlockComment = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		const next = text[index + 1];

		if (inBlockComment) {
			if (char === "*" && next === "/") {
				inBlockComment = false;
				index += 1;
			}
			continue;
		}

		if (inString) {
			out += char;
			if (inEscape) inEscape = false;
			else if (char === "\\") inEscape = true;
			else if (char === "\"") inString = false;
			continue;
		}

		if (char === "\"") {
			inString = true;
			out += char;
			continue;
		}
		if (char === "/" && next === "/") {
			while (index < text.length && text[index] !== "\n") index += 1;
			out += "\n";
			continue;
		}
		if (char === "/" && next === "*") {
			inBlockComment = true;
			index += 1;
			continue;
		}
		out += char;
	}

	return out;
}

/** Where the extension's own defaults live. */
export function extensionConfigPath(extensionDir: string): string {
	return join(extensionDir, "config.json");
}

/** Where the user's cross-project defaults live: <agentDir>/pi-think-different.json. */
export function agentConfigPath(agentDir: string): string {
	return join(agentDir, "pi-think-different.json");
}

/** Where a project overrides both: <cwd>/.pi/pi-think-different.json. */
export function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", "pi-think-different.json");
}

/** Pi's config directory, honouring PI_CODING_AGENT_DIR. */
export function resolveAgentDir(env: Record<string, string | undefined>, homeDir: string): string {
	const override = env.PI_CODING_AGENT_DIR?.trim();
	return override && override.length > 0 ? override : join(homeDir, ".pi", "agent");
}

/** All three files in increasing precedence order. */
export function configLayerPaths(extensionDir: string, agentDir: string, cwd: string): { kind: "extension" | "agent" | "project"; path: string }[] {
	return [
		{ kind: "extension", path: extensionConfigPath(extensionDir) },
		{ kind: "agent", path: agentConfigPath(agentDir) },
		{ kind: "project", path: projectConfigPath(cwd) },
	];
}

/** The example config written for a user who has none yet. */
export const EXAMPLE_CONFIG = `{
	// What a session starts with: a paradigm id or alias, "auto", or "off".
	"startup": "off",

	// light | standard | deep
	"intensity": "standard",

	// "answer": the paradigm's structure is shown in the answer.
	// "thinking": the structure is kept in the thinking block and the answer
	// carries only the conclusion.
	"placement": "answer",

	// en | zh - language for /think menus, help, status, and notifications.
	"language": "en"
}
`;
