import { createRequire } from "node:module";
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import chokidar from "chokidar";
import { WebSocket, WebSocketServer } from "ws";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import * as pty from "node-pty";
//#region src/wire.ts
var WorkbenchError = class extends Error {
	code;
	status;
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
};
async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += value.length;
		if (size > 2097152) throw new WorkbenchError("too-large", "request body is too large", 413);
		chunks.push(value);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
		if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("object expected");
		return value;
	} catch {
		throw new WorkbenchError("bad-json", "request body must be a JSON object");
	}
}
/** Read a binary upload while enforcing a fixed request limit. */
async function readBinaryBody(req, limit = 104857600) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += value.length;
		if (size > limit) throw new WorkbenchError("too-large", "uploaded file is too large", 413);
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}
function stringField(body, key) {
	const value = body[key];
	if (typeof value !== "string") throw new WorkbenchError("bad-request", `${key} must be a string`);
	return value;
}
function send(res, status, value) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(value));
}
function sendError(res, error) {
	const known = error instanceof WorkbenchError ? error : new WorkbenchError("internal", error instanceof Error ? error.message : String(error), 500);
	send(res, known.status, {
		ok: false,
		error: {
			code: known.code,
			message: known.message
		}
	});
}
function trusted(req, allowed) {
	const host = req.headers.host;
	if (host === void 0 || req.headers["sec-fetch-site"] === "cross-site") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (!(hostUrl.hostname === "localhost" || hostUrl.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostUrl.hostname)) && !allowed.some((candidate) => candidate === host || candidate === hostUrl.hostname)) return false;
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/host.ts
const require = createRequire(import.meta.url);
const TEXT_LIMIT = 5242880;
const PROCESS_TIMEOUT = 3e4;
function cwdFor(ctx, sessionId) {
	const cwd = ctx.sessions.get(sessionId)?.header.cwd;
	if (cwd === void 0 || cwd === "") return process.cwd();
	if (!isAbsolute(cwd)) throw new WorkbenchError("cwd-invalid", "session working directory is not absolute");
	return normalize(cwd);
}
function inside(root, target) {
	const rel = relative(root, target);
	return rel === "" || !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}
async function canonicalRoot(cwd) {
	return realpath(cwd).catch(() => {
		throw new WorkbenchError("cwd-missing", "session working directory does not exist", 404);
	});
}
/** Resolve a caller-relative path and reject traversal and symlink escape. */
async function workspacePath(cwd, raw, create = false) {
	if (isAbsolute(raw)) throw new WorkbenchError("path-invalid", "absolute paths are not accepted");
	const root = await canonicalRoot(cwd);
	const absolute = resolve(root, raw === "" ? "." : raw);
	if (!inside(root, absolute)) throw new WorkbenchError("path-outside", "path is outside the workspace", 403);
	if (create) {
		if (!inside(root, await realpath(dirname(absolute)).catch(() => {
			throw new WorkbenchError("parent-missing", "parent directory does not exist", 404);
		}))) throw new WorkbenchError("path-outside", "path follows a symlink outside the workspace", 403);
	} else if (!inside(root, await realpath(absolute).catch(() => {
		throw new WorkbenchError("not-found", "path does not exist", 404);
	}))) throw new WorkbenchError("path-outside", "path follows a symlink outside the workspace", 403);
	return {
		root,
		absolute
	};
}
function relativePath(root, absolute) {
	return relative(root, absolute).split(sep).join("/");
}
function revision(content, mtimeMs) {
	return createHash("sha256").update(content).update(String(mtimeMs)).digest("hex");
}
async function listFiles(cwd, path) {
	const { root, absolute } = await workspacePath(cwd, path);
	const values = await readdir(absolute, { withFileTypes: true });
	return (await Promise.all(values.filter((item) => item.name !== ".git").map(async (item) => {
		const full = join(absolute, item.name);
		if (!item.isSymbolicLink()) return {
			name: item.name,
			path: relativePath(root, full),
			kind: item.isDirectory() ? "directory" : "file"
		};
		const actual = await realpath(full).catch(() => void 0);
		if (actual === void 0 || !inside(root, actual)) return void 0;
		const info = await stat(full);
		const kind = info.isDirectory() ? "directory" : "file";
		return {
			name: item.name,
			path: relativePath(root, full),
			kind,
			size: info.size,
			mtimeMs: info.mtimeMs
		};
	}))).filter((row) => row !== void 0).sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
}
async function readDocument(cwd, path) {
	const { root, absolute } = await workspacePath(cwd, path);
	const info = await stat(absolute);
	if (!info.isFile()) throw new WorkbenchError("not-file", "path is not a file");
	const tooLarge = info.size > TEXT_LIMIT;
	const handle = await open(absolute, "r");
	try {
		const head = Buffer.alloc(Math.min(info.size, tooLarge ? 4096 : TEXT_LIMIT));
		const { bytesRead } = await handle.read(head, 0, head.length, 0);
		const bytes = head.subarray(0, bytesRead);
		const binary = bytes.includes(0);
		return {
			path: relativePath(root, absolute),
			content: binary || tooLarge ? "" : bytes.toString("utf8"),
			revision: revision(bytes, info.mtimeMs),
			size: info.size,
			binary,
			tooLarge
		};
	} finally {
		await handle.close();
	}
}
async function saveDocument(cwd, path, content, expected) {
	const { absolute } = await workspacePath(cwd, path);
	if ((await readDocument(cwd, path)).revision !== expected) throw new WorkbenchError("revision-conflict", "file changed on disk; reload before saving", 409);
	const temp = join(dirname(absolute), `.${randomUUID()}.dsh-vscode.tmp`);
	await writeFile(temp, content, {
		encoding: "utf8",
		flag: "wx"
	});
	try {
		await rename(temp, absolute);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
	return readDocument(cwd, path);
}
async function createEntry(cwd, path, kind) {
	const { absolute } = await workspacePath(cwd, path, true);
	if (kind === "directory") await mkdir(absolute);
	else await (await open(absolute, "wx")).close();
}
/** Write an uploaded file into an existing workspace directory without overwriting files. */
async function uploadFile(cwd, directory, name, content) {
	if (name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\\")) throw new WorkbenchError("filename-invalid", "uploaded file name is invalid");
	const { root, absolute } = await workspacePath(cwd, directory === "" ? name : `${directory}/${name}`, true);
	const handle = await open(absolute, "wx");
	try {
		await handle.writeFile(content);
	} finally {
		await handle.close();
	}
	const info = await lstat(absolute);
	return {
		name,
		path: relativePath(root, absolute),
		kind: "file",
		size: info.size,
		mtimeMs: info.mtimeMs
	};
}
async function renameEntry(cwd, path, nextPath) {
	const source = await workspacePath(cwd, path);
	const target = await workspacePath(cwd, nextPath, true);
	await access(target.absolute, constants.F_OK).then(() => {
		throw new WorkbenchError("target-exists", "destination already exists", 409);
	}, () => void 0);
	await rename(source.absolute, target.absolute);
}
async function deleteEntry(cwd, path) {
	if (path === "") throw new WorkbenchError("root-delete", "cannot delete workspace root", 403);
	const { absolute } = await workspacePath(cwd, path);
	await rm(absolute, {
		recursive: true,
		force: false
	});
}
const PREVIEW_TYPES = {
	".avif": "image/avif",
	".bmp": "image/bmp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".pdf": "application/pdf",
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".odt": "application/vnd.oasis.opendocument.text"
};
/** Resolve a supported preview file inside the workspace. */
async function workspacePreviewFile(cwd, path) {
	const resolved = await workspacePath(cwd, path);
	const type = PREVIEW_TYPES[extname(resolved.absolute).toLowerCase()];
	if (type === void 0) throw new WorkbenchError("unsupported-media", "file is not a supported preview format", 415);
	return {
		path: resolved.absolute,
		type
	};
}
/** Resolve the PDF.js worker shipped with this plugin's runtime dependency. */
function pdfWorkerAsset() {
	return {
		path: require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
		type: "text/javascript; charset=utf-8"
	};
}
function run(command, args, cwd, timeout = PROCESS_TIMEOUT, signal) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd,
			shell: false,
			windowsHide: true
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			child.kill();
			if (!settled) reject(new WorkbenchError("timeout", `${command} timed out`, 504));
		}, timeout);
		const abort = () => {
			child.kill();
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(new WorkbenchError("cancelled", `${command} cancelled`, 499));
			}
		};
		signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			if (!settled) {
				settled = true;
				reject(error);
			}
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			if (!settled) {
				settled = true;
				resolvePromise({
					stdout,
					stderr,
					code: code ?? 1
				});
			}
		});
	});
}
async function searchWorkspace(cwd, request, signal) {
	if (request.query === "") return {
		matches: [],
		limited: false
	};
	const root = await canonicalRoot(cwd);
	const rg = require("@vscode/ripgrep").rgPath;
	const args = [
		"--json",
		"--line-number",
		"--column",
		"--hidden",
		"--glob",
		"!.git/**",
		"--max-count",
		"2000"
	];
	if (!request.regex) args.push("--fixed-strings");
	if (!request.caseSensitive) args.push("--ignore-case");
	if (request.wholeWord) args.push("--word-regexp");
	if (request.include) args.push("--glob", request.include);
	if (request.exclude) args.push("--glob", `!${request.exclude}`);
	args.push("--", request.query, ".");
	const result = await run(rg, args, root, PROCESS_TIMEOUT, signal);
	if (result.code > 1) throw new WorkbenchError("search-failed", result.stderr || "ripgrep failed", 500);
	const matches = [];
	for (const line of result.stdout.split("\n")) {
		if (line === "") continue;
		const event = JSON.parse(line);
		if (event.type !== "match" || event.data?.path?.text === void 0 || event.data.lines?.text === void 0) continue;
		for (const hit of event.data.submatches ?? []) {
			matches.push({
				path: event.data.path.text.replace(/^\.\//, ""),
				line: event.data.line_number ?? 1,
				column: hit.start + 1,
				preview: event.data.lines.text.trimEnd(),
				match: hit.match?.text ?? ""
			});
			if (matches.length >= 2e3) return {
				matches,
				limited: true
			};
		}
	}
	return {
		matches,
		limited: false
	};
}
async function gitRoot(cwd) {
	const result = await run("git", ["rev-parse", "--show-toplevel"], cwd);
	if (result.code !== 0) throw new WorkbenchError("not-repository", "current workspace is not inside a Git repository", 404);
	return result.stdout.trim();
}
function validateCommitHash(value) {
	if (!/^[0-9a-f]{7,64}$/i.test(value ?? "")) throw new WorkbenchError("bad-request", "commit hash is invalid");
	return value;
}
function validateGitPath(repository, path) {
	if (path === void 0 || path === "" || isAbsolute(path) || !inside(repository, resolve(repository, path))) throw new WorkbenchError("bad-request", "repository-relative path is required");
	return path;
}
async function gitObject(repository, spec) {
	const result = await run("git", [
		"show",
		"--no-textconv",
		spec
	], repository);
	return result.code === 0 ? result.stdout : "";
}
async function commitFiles(repository, hash) {
	const parent = await run("git", [
		"rev-parse",
		"--verify",
		`${hash}^1`
	], repository);
	const result = parent.code === 0 ? await run("git", [
		"diff",
		"--name-status",
		"-z",
		"-M",
		parent.stdout.trim(),
		hash,
		"--"
	], repository) : await run("git", [
		"diff-tree",
		"--root",
		"--no-commit-id",
		"--name-status",
		"-r",
		"-z",
		"-M",
		hash
	], repository);
	if (result.code !== 0) throw new WorkbenchError("git-failed", result.stderr || result.stdout, 409);
	const tokens = result.stdout.split("\0").filter(Boolean);
	const files = [];
	for (let index = 0; index < tokens.length;) {
		const code = (tokens[index++] ?? "")[0] ?? "";
		if (code === "R" || code === "C") {
			const previousPath = tokens[index++] ?? "";
			const path = tokens[index++] ?? "";
			files.push({
				path,
				previousPath,
				status: code
			});
		} else {
			const path = tokens[index++] ?? "";
			files.push({
				path,
				status: code
			});
		}
	}
	return files;
}
async function gitStatus(cwd) {
	const repository = await gitRoot(cwd);
	const result = await run("git", [
		"status",
		"--porcelain=v2",
		"-z",
		"--branch",
		"--untracked-files=all"
	], repository);
	if (result.code !== 0) throw new WorkbenchError("git-failed", result.stderr, 500);
	let branch = "HEAD";
	let ahead = 0;
	let behind = 0;
	const changes = [];
	for (const record of result.stdout.split("\0")) if (record.startsWith("# branch.head ")) branch = record.slice(14);
	else if (record.startsWith("# branch.ab ")) {
		const match = /\+(\d+) -(\d+)/.exec(record);
		ahead = Number(match?.[1] ?? 0);
		behind = Number(match?.[2] ?? 0);
	} else if (record.startsWith("? ")) changes.push({
		path: record.slice(2),
		index: "?",
		worktree: "?",
		staged: false,
		untracked: true
	});
	else if (record.startsWith("1 ") || record.startsWith("2 ")) {
		const parts = record.split(" ");
		const xy = parts[1] ?? "..";
		const path = parts.slice(record.startsWith("2 ") ? 9 : 8).join(" ");
		changes.push({
			path,
			index: xy[0] ?? ".",
			worktree: xy[1] ?? ".",
			staged: xy[0] !== ".",
			untracked: false
		});
	}
	return {
		repository,
		branch,
		ahead,
		behind,
		changes
	};
}
async function gitAction(cwd, action, path, value) {
	const repository = await gitRoot(cwd);
	let args;
	switch (action) {
		case "stage":
			args = [
				"add",
				"--",
				path ?? ""
			];
			break;
		case "stage.all":
			args = ["add", "-A"];
			break;
		case "unstage":
			args = [
				"restore",
				"--staged",
				"--",
				path ?? ""
			];
			break;
		case "unstage.all":
			args = [
				"restore",
				"--staged",
				"--",
				"."
			];
			break;
		case "discard":
			args = value === "untracked" ? [
				"clean",
				"-f",
				"--",
				path ?? ""
			] : [
				"restore",
				"--worktree",
				"--",
				path ?? ""
			];
			break;
		case "discard.all": {
			if ((await run("git", [
				"rev-parse",
				"--verify",
				"HEAD"
			], repository)).code === 0) {
				const restore = await run("git", [
					"restore",
					"--source=HEAD",
					"--staged",
					"--worktree",
					"--",
					"."
				], repository);
				if (restore.code !== 0) throw new WorkbenchError("git-failed", restore.stderr || restore.stdout, 409);
			}
			const clean = await run("git", ["clean", "-fd"], repository);
			if (clean.code !== 0) throw new WorkbenchError("git-failed", clean.stderr || clean.stdout, 409);
			return gitStatus(cwd);
		}
		case "commit":
			args = [
				"commit",
				"-m",
				value ?? ""
			];
			break;
		case "branch.create":
			args = [
				"switch",
				"-c",
				value ?? ""
			];
			break;
		case "branch.switch":
			args = ["switch", value ?? ""];
			break;
		case "branches": {
			const result = await run("git", [
				"for-each-ref",
				"--format=%(refname:short)",
				"refs/heads"
			], repository);
			if (result.code !== 0) throw new WorkbenchError("git-failed", result.stderr, 500);
			return result.stdout.split("\n").filter(Boolean);
		}
		case "log": {
			if ((await run("git", [
				"rev-parse",
				"--verify",
				"HEAD"
			], repository)).code !== 0) return [];
			const result = await run("git", [
				"log",
				"--topo-order",
				"--date=iso-strict",
				"--decorate=short",
				"--pretty=format:%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x00",
				"-n",
				"100"
			], repository);
			if (result.code !== 0) throw new WorkbenchError("git-failed", result.stderr || result.stdout, 500);
			return result.stdout.split("\0").filter(Boolean).map((record) => {
				const [rawHash = "", parents = "", author = "", date = "", subject = "", refs = ""] = record.split("");
				return {
					hash: rawHash.trim(),
					parents: parents.split(" ").filter(Boolean),
					author,
					date,
					subject,
					refs: refs.split(",").map((item) => item.trim()).filter(Boolean)
				};
			});
		}
		case "commit.show": {
			const result = await run("git", [
				"show",
				"--no-ext-diff",
				"--find-renames",
				"--format=fuller",
				"--stat",
				"--patch",
				"--no-color",
				validateCommitHash(value)
			], repository);
			if (result.code !== 0) throw new WorkbenchError("git-failed", result.stderr || result.stdout, 409);
			return {
				diff: result.stdout,
				original: "",
				modified: result.stdout
			};
		}
		case "commit.files": return commitFiles(repository, validateCommitHash(value));
		case "commit.file.diff": {
			const hash = validateCommitHash(value);
			const target = validateGitPath(repository, path);
			const file = (await commitFiles(repository, hash)).find((item) => item.path === target);
			if (file === void 0) throw new WorkbenchError("not-found", "file is not part of the commit", 404);
			const parent = await run("git", [
				"rev-parse",
				"--verify",
				`${hash}^1`
			], repository);
			const shown = parent.code === 0 ? await run("git", [
				"diff",
				"--no-ext-diff",
				"--find-renames",
				"--patch",
				"--no-color",
				parent.stdout.trim(),
				hash,
				"--",
				file.previousPath ?? target,
				target
			], repository) : await run("git", [
				"show",
				"--no-ext-diff",
				"--find-renames",
				"--format=",
				"--patch",
				"--no-color",
				hash,
				"--",
				file.previousPath ?? target,
				target
			], repository);
			if (shown.code !== 0) throw new WorkbenchError("git-failed", shown.stderr || shown.stdout, 409);
			const original = file.status === "A" || parent.code !== 0 ? "" : await gitObject(repository, `${parent.stdout.trim()}:${file.previousPath ?? target}`);
			const modified = file.status === "D" ? "" : await gitObject(repository, `${hash}:${target}`);
			return {
				diff: shown.stdout,
				original,
				modified
			};
		}
		case "diff":
			args = value === "untracked" ? [
				"diff",
				"--no-index",
				"--",
				process.platform === "win32" ? "NUL" : "/dev/null",
				path ?? ""
			] : [
				"diff",
				...value === "staged" ? ["--cached"] : [],
				"--",
				path ?? ""
			];
			break;
		default: throw new WorkbenchError("bad-action", `unknown Git action ${action}`);
	}
	if (args.some((arg) => arg === "") && action !== "commit") throw new WorkbenchError("bad-request", "path or value is required");
	const result = await run("git", args, repository);
	const expectedUntrackedDifference = action === "diff" && value === "untracked" && result.code === 1;
	if (result.code !== 0 && !expectedUntrackedDifference) throw new WorkbenchError("git-failed", result.stderr || result.stdout, 409);
	if (action !== "diff") return gitStatus(cwd);
	const target = validateGitPath(repository, path);
	const original = value === "untracked" ? "" : await gitObject(repository, `${value === "staged" ? "HEAD:" : ":"}${target}`);
	const modified = value === "staged" ? await gitObject(repository, `:${target}`) : await readFile(resolve(repository, target), "utf8").catch(() => "");
	return {
		diff: result.stdout,
		original,
		modified
	};
}
/** Resolve the official VS Code Codicon font shipped by @vscode/codicons. */
function codiconAsset() {
	const packageRoot = dirname(require.resolve("@vscode/codicons/package.json"));
	return {
		path: resolve(packageRoot, "dist", "codicon.ttf"),
		type: "font/ttf"
	};
}
function monacoAsset(raw) {
	const packageRoot = dirname(require.resolve("monaco-editor/package.json"));
	const path = resolve(packageRoot, "min", raw);
	if (!inside(resolve(packageRoot, "min"), path)) throw new WorkbenchError("asset-invalid", "invalid Monaco asset path", 403);
	return {
		path,
		type: extname(path) === ".css" ? "text/css" : extname(path) === ".js" ? "text/javascript" : extname(path) === ".ttf" ? "font/ttf" : "application/octet-stream"
	};
}
//#endregion
//#region src/terminal.ts
const SENSITIVE = /(api[_-]?key|token|credential|secret|password|passwd|private[_-]?key|^dsh_.*(?:key|token|secret))/i;
const MAX_TERMINALS = 8;
const REPLAY_BYTES = 2097152;
/** Remove credentials while retaining ordinary interactive-shell variables. */
function sanitizedTerminalEnv(env) {
	return Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== void 0 && !SENSITIVE.test(key)));
}
/** Select the user's interactive shell with platform-specific fallbacks. */
function defaultTerminalShell(platform = process.platform, env = process.env) {
	if (platform === "win32") return {
		shell: env.COMSPEC?.toLowerCase().includes("powershell") ? env.COMSPEC : "powershell.exe",
		args: ["-NoLogo"]
	};
	return {
		shell: env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
		args: ["-l"]
	};
}
/** Own interactive terminals by their canonical workspace directory. */
var TerminalManager = class {
	workspaces = /* @__PURE__ */ new Map();
	workspace(cwd) {
		return realpathSync(cwd);
	}
	list(cwd) {
		return [...this.workspaces.get(this.workspace(cwd))?.values() ?? []].map((handle) => ({ ...handle.info }));
	}
	create(cwd, title) {
		const key = this.workspace(cwd);
		const terminals = this.workspaces.get(key) ?? /* @__PURE__ */ new Map();
		this.workspaces.set(key, terminals);
		if (terminals.size >= MAX_TERMINALS) throw new Error(`terminal limit reached (${MAX_TERMINALS})`);
		const { shell, args } = defaultTerminalShell();
		const child = pty.spawn(shell, args, {
			name: "xterm-256color",
			cols: 80,
			rows: 24,
			cwd: key,
			env: sanitizedTerminalEnv(process.env)
		});
		const info = {
			id: randomUUID(),
			title: title || basename(shell),
			cwd: key,
			running: true,
			sequence: 0
		};
		const handle = {
			info,
			process: child,
			replay: "",
			listeners: /* @__PURE__ */ new Set()
		};
		terminals.set(info.id, handle);
		child.onData((data) => {
			info.sequence++;
			handle.replay += data;
			if (Buffer.byteLength(handle.replay) > REPLAY_BYTES) handle.replay = handle.replay.slice(-2097152);
			for (const listener of handle.listeners) listener({
				sequence: info.sequence,
				data
			});
		});
		child.onExit(({ exitCode }) => {
			info.running = false;
			info.exitCode = exitCode;
			info.sequence++;
			const data = `\r\n[process exited with code ${exitCode}]\r\n`;
			for (const listener of handle.listeners) listener({
				sequence: info.sequence,
				data
			});
		});
		return { ...info };
	}
	get(cwd, id) {
		return this.workspaces.get(this.workspace(cwd))?.get(id);
	}
	close(cwd, id) {
		const key = this.workspace(cwd);
		const terminals = this.workspaces.get(key);
		const handle = terminals?.get(id);
		if (handle === void 0 || terminals === void 0) return;
		terminals.delete(id);
		try {
			handle.process.kill();
		} catch {}
		if (terminals.size === 0) this.workspaces.delete(key);
	}
	rename(cwd, id, title) {
		const handle = this.get(cwd, id);
		if (handle === void 0) throw new Error("terminal not found");
		handle.info.title = title;
		return { ...handle.info };
	}
	dispose() {
		for (const [cwd, terminals] of this.workspaces) for (const id of terminals.keys()) this.close(cwd, id);
	}
};
function terminalRequestAllowed(req) {
	const host = req.headers.host;
	if (host === void 0 || req.headers["sec-fetch-site"] === "cross-site") return false;
	let hostname;
	try {
		hostname = new URL(`http://${host}`).hostname;
	} catch {
		return false;
	}
	if (hostname !== "localhost" && hostname !== "[::1]" && !hostname.startsWith("127.")) return false;
	const origin = req.headers.origin;
	try {
		return origin === void 0 || new URL(origin).host === host;
	} catch {
		return false;
	}
}
/** Register the private local terminal API and WebSocket transport. */
function installTerminal(ctx) {
	const manager = new TerminalManager();
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/dsh-vscode-terminal/api",
		handler: async (req, res) => {
			if (!terminalRequestAllowed(req)) return send(res, 403, {
				ok: false,
				error: { message: "forbidden" }
			});
			if (req.method !== "POST") return send(res, 405, {
				ok: false,
				error: { message: "POST required" }
			});
			try {
				const body = await readBody(req);
				const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
				if (sessionId === "") throw new Error("sessionId required");
				const cwd = cwdFor(ctx, sessionId);
				const method = new URL(req.url ?? "/", "http://dsh.local").pathname.slice(25);
				let value;
				if (method === "list") value = manager.list(cwd);
				else if (method === "create") value = manager.create(cwd, typeof body.title === "string" ? body.title : void 0);
				else if (method === "close") {
					manager.close(cwd, typeof body.id === "string" ? body.id : "");
					value = manager.list(cwd);
				} else if (method === "rename") value = manager.rename(cwd, typeof body.id === "string" ? body.id : "", typeof body.title === "string" ? body.title : "");
				else throw new Error("unknown terminal method");
				send(res, 200, {
					ok: true,
					value
				});
			} catch (error) {
				sendError(res, error);
			}
		}
	}), "dsh-vscode-workbench: terminal API");
	const webSocket = new WebSocketServer({ noServer: true });
	ctx.effect(() => ctx.webServer.registerUpgrade({
		path: "/dsh-vscode-terminal/ws",
		handler(req, socket, head) {
			if (!terminalRequestAllowed(req)) {
				socket.destroy();
				return;
			}
			webSocket.handleUpgrade(req, socket, head, (connection) => {
				const url = new URL(req.url ?? "/", "http://dsh.local");
				const sessionId = url.searchParams.get("sessionId");
				const id = url.searchParams.get("id");
				if (sessionId === null || id === null) {
					connection.close(1008, "sessionId and id required");
					return;
				}
				const handle = manager.get(cwdFor(ctx, sessionId), id);
				if (handle === void 0) {
					connection.close(1008, "terminal not found");
					return;
				}
				if (handle.replay !== "") connection.send(JSON.stringify({
					type: "replay",
					sequence: handle.info.sequence,
					data: handle.replay
				}));
				const listener = (output) => {
					if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({
						type: "output",
						...output
					}));
				};
				handle.listeners.add(listener);
				connection.on("message", (raw) => {
					const text = raw.toString();
					try {
						const message = JSON.parse(text);
						if (message !== null && typeof message === "object" && "type" in message && message.type === "input" && "data" in message && typeof message.data === "string") handle.process.write(message.data);
						else if (message !== null && typeof message === "object" && "type" in message && message.type === "resize" && "cols" in message && "rows" in message && typeof message.cols === "number" && typeof message.rows === "number") handle.process.resize(Math.max(2, Math.floor(message.cols)), Math.max(2, Math.floor(message.rows)));
					} catch {
						handle.process.write(text);
					}
				});
				connection.on("close", () => handle.listeners.delete(listener));
			});
		}
	}), "dsh-vscode-workbench: terminal WebSocket");
	ctx.effect(() => () => {
		webSocket.close();
		manager.dispose();
	}, "dsh-vscode-workbench: terminal teardown");
}
//#endregion
//#region src/index.ts
/** DSH host plugin for the VS Code workbench. */
const name = "dsh-vscode-workbench";
const inject = [
	"webServer",
	"sessions",
	"webRuntime"
];
async function dispatch(ctx, method, body, signal) {
	const cwd = cwdFor(ctx, stringField(body, "sessionId"));
	switch (method) {
		case "workspace": return {
			cwd,
			name: cwd.split(/[\\/]/).at(-1) || cwd
		};
		case "fs.list": return listFiles(cwd, stringField(body, "path"));
		case "fs.read": return readDocument(cwd, stringField(body, "path"));
		case "fs.save": return saveDocument(cwd, stringField(body, "path"), stringField(body, "content"), stringField(body, "revision"));
		case "fs.create": return createEntry(cwd, stringField(body, "path"), body.kind === "directory" ? "directory" : "file").then(() => ({ ok: true }));
		case "fs.rename": return renameEntry(cwd, stringField(body, "path"), stringField(body, "nextPath")).then(() => ({ ok: true }));
		case "fs.delete": return deleteEntry(cwd, stringField(body, "path")).then(() => ({ ok: true }));
		case "search": return searchWorkspace(cwd, body, signal);
		case "git.status": return gitStatus(cwd);
		case "git.action": return gitAction(cwd, stringField(body, "action"), typeof body.path === "string" ? body.path : void 0, typeof body.value === "string" ? body.value : void 0);
		default: throw new WorkbenchError("not-found", `unknown workbench API method ${method}`, 404);
	}
}
function apply(ctx) {
	installTerminal(ctx);
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-vscode/codicons/codicon.ttf",
		handler: async (req, res) => {
			if (!trusted(req, ctx.webRuntime.trustedHosts)) {
				res.writeHead(403);
				res.end();
				return;
			}
			try {
				const asset = codiconAsset();
				res.writeHead(200, {
					"content-type": asset.type,
					"cache-control": "public, max-age=31536000, immutable"
				});
				res.end(await readFile(asset.path));
			} catch (error) {
				sendError(res, error);
			}
		}
	}), "dsh-vscode-workbench: Codicon font");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-vscode/pdfjs/worker.mjs",
		handler: async (req, res) => {
			if (!trusted(req, ctx.webRuntime.trustedHosts)) {
				res.writeHead(403);
				res.end();
				return;
			}
			try {
				const asset = pdfWorkerAsset();
				res.writeHead(200, {
					"content-type": asset.type,
					"cache-control": "public, max-age=31536000, immutable"
				});
				res.end(await readFile(asset.path));
			} catch (error) {
				sendError(res, error);
			}
		}
	}), "dsh-vscode-workbench: PDF.js worker");
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/dsh-vscode/api",
		handler: async (req, res) => {
			if (!trusted(req, ctx.webRuntime.trustedHosts)) return send(res, 403, {
				ok: false,
				error: {
					code: "forbidden",
					message: "forbidden"
				}
			});
			if (req.method !== "POST") return send(res, 405, {
				ok: false,
				error: {
					code: "method",
					message: "POST required"
				}
			});
			try {
				const controller = new AbortController();
				req.once("aborted", () => controller.abort());
				send(res, 200, {
					ok: true,
					value: await dispatch(ctx, new URL(req.url ?? "/", "http://dsh.local").pathname.slice(16), await readBody(req), controller.signal)
				});
			} catch (error) {
				sendError(res, error);
			}
		}
	}), "dsh-vscode-workbench: API");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-vscode/upload",
		handler: async (req, res) => {
			if (!trusted(req, ctx.webRuntime.trustedHosts)) return send(res, 403, {
				ok: false,
				error: {
					code: "forbidden",
					message: "forbidden"
				}
			});
			if (req.method !== "POST") return send(res, 405, {
				ok: false,
				error: {
					code: "method",
					message: "POST required"
				}
			});
			try {
				const url = new URL(req.url ?? "/", "http://dsh.local");
				const sessionId = url.searchParams.get("sessionId");
				const directory = url.searchParams.get("directory");
				const name = url.searchParams.get("name");
				if (sessionId === null || directory === null || name === null) throw new WorkbenchError("bad-request", "sessionId, directory and name are required");
				send(res, 201, {
					ok: true,
					value: await uploadFile(cwdFor(ctx, sessionId), directory, name, await readBinaryBody(req))
				});
			} catch (error) {
				sendError(res, error);
			}
		}
	}), "dsh-vscode-workbench: file upload");
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/dsh-vscode/file",
		handler: async (req, res) => {
			if (!trusted(req, ctx.webRuntime.trustedHosts)) {
				res.writeHead(403);
				res.end();
				return;
			}
			try {
				const url = new URL(req.url ?? "/", "http://dsh.local");
				const sessionId = url.searchParams.get("sessionId");
				const path = url.searchParams.get("path");
				if (sessionId === null || path === null) throw new WorkbenchError("bad-request", "sessionId and path are required");
				const asset = await workspacePreviewFile(cwdFor(ctx, sessionId), path);
				res.writeHead(200, {
					"content-type": asset.type,
					"x-content-type-options": "nosniff",
					"cache-control": "no-store"
				});
				res.end(await readFile(asset.path));
			} catch (error) {
				sendError(res, error);
			}
		}
	}), "dsh-vscode-workbench: file preview");
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/dsh-vscode/monaco",
		handler: async (req, res) => {
			if (!trusted(req, ctx.webRuntime.trustedHosts)) {
				res.writeHead(403);
				res.end();
				return;
			}
			try {
				const asset = monacoAsset(decodeURIComponent(new URL(req.url ?? "/", "http://dsh.local").pathname.slice(19)));
				res.writeHead(200, {
					"content-type": asset.type,
					"cache-control": "public, max-age=31536000, immutable"
				});
				res.end(await readFile(asset.path));
			} catch (error) {
				sendError(res, error);
			}
		}
	}), "dsh-vscode-workbench: Monaco assets");
	const wss = new WebSocketServer({ noServer: true });
	ctx.effect(() => ctx.webServer.registerUpgrade({
		path: "/dsh-vscode/ws/files",
		handler(req, socket, head) {
			if (!trusted(req, ctx.webRuntime.trustedHosts)) {
				socket.destroy();
				return;
			}
			wss.handleUpgrade(req, socket, head, (ws) => {
				const sessionId = new URL(req.url ?? "/", "http://dsh.local").searchParams.get("sessionId");
				if (sessionId === null) {
					ws.close(1008, "sessionId required");
					return;
				}
				const workspace = cwdFor(ctx, sessionId);
				const watcher = chokidar.watch(workspace, {
					ignoreInitial: true,
					ignored: /(^|[/\\])(\.git|node_modules|\.next|\.nuxt|\.turbo|\.vite|coverage)([/\\]|$)/,
					awaitWriteFinish: {
						stabilityThreshold: 100,
						pollInterval: 25
					}
				});
				let paths = /* @__PURE__ */ new Set();
				let timer;
				watcher.on("all", (_event, path) => {
					const changed = isAbsolute(path) ? relative(workspace, path) : path;
					paths.add(changed.split(sep).join("/"));
					clearTimeout(timer);
					timer = setTimeout(() => {
						if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
							type: "files.changed",
							paths: [...paths]
						}));
						paths = /* @__PURE__ */ new Set();
					}, 150);
				});
				ws.on("close", () => {
					clearTimeout(timer);
					watcher.close();
				});
			});
		}
	}), "dsh-vscode-workbench: file watcher");
	ctx.effect(() => () => {
		wss.close();
	}, "dsh-vscode-workbench: watcher teardown");
}
//#endregion
export { WorkbenchError, apply, inject, name };

//# sourceMappingURL=index.js.map