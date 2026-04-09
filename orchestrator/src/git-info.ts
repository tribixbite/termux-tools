/**
 * git-info.ts — Git repository status, file tree, and file content reader
 *
 * Provides git branch/status/log info and safe file browsing for session projects.
 * All file access is path-traversal-protected.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, resolve, extname, basename } from "node:path";
import type { GitInfo, FileEntry, FileContentResponse } from "./types.js";

const MAX_FILE_SIZE = 100 * 1024; // 100KB max file content
const MAX_ENTRIES = 200; // Max directory entries

/** Language detection from file extension */
const LANG_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
  ".py": "python", ".rs": "rust", ".go": "go", ".java": "java", ".kt": "kotlin",
  ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
  ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
  ".md": "markdown", ".html": "html", ".css": "css", ".scss": "scss",
  ".svelte": "svelte", ".astro": "astro", ".vue": "vue",
  ".sh": "bash", ".bash": "bash", ".zsh": "zsh",
  ".sql": "sql", ".graphql": "graphql",
  ".xml": "xml", ".svg": "svg",
  ".env": "dotenv", ".gitignore": "gitignore",
  ".dockerfile": "dockerfile",
};

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (LANG_MAP[ext]) return LANG_MAP[ext];
  const base = basename(filePath).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  return "text";
}

/** Run a git command in a project directory, return stdout */
function gitCmd(projectPath: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: projectPath,
    encoding: "utf-8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.stdout?.trim() ?? "";
}

/** Get git repository info for a project */
export function getGitInfo(projectPath: string): GitInfo {
  // Current branch
  const branch = gitCmd(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";

  // Dirty files (porcelain format)
  const statusOut = gitCmd(projectPath, ["status", "--porcelain"]);
  const dirty_files = statusOut
    ? statusOut.split("\n").map(l => l.trim()).filter(Boolean)
    : [];

  // Recent commits (last 5, one-line format)
  const logOut = gitCmd(projectPath, ["log", "--oneline", "-5"]);
  const recent_commits = logOut
    ? logOut.split("\n").filter(Boolean).map(line => {
        const spaceIdx = line.indexOf(" ");
        return {
          hash: spaceIdx > 0 ? line.slice(0, spaceIdx) : line,
          message: spaceIdx > 0 ? line.slice(spaceIdx + 1) : "",
        };
      })
    : [];

  return { branch, dirty_files, recent_commits };
}

/** Get file tree for a directory within a project (path-traversal protected) */
export function getFileTree(projectPath: string, subdir?: string): FileEntry[] {
  const targetDir = subdir
    ? resolve(projectPath, subdir)
    : projectPath;

  // Path traversal protection: resolved path must start with project path
  if (!targetDir.startsWith(projectPath + "/") && targetDir !== projectPath) {
    throw new Error("Path traversal blocked");
  }

  const entries: FileEntry[] = [];
  try {
    const items = readdirSync(targetDir, { withFileTypes: true });
    for (const item of items) {
      if (entries.length >= MAX_ENTRIES) break;
      // Skip hidden files/dirs (except .gitignore, etc.)
      if (item.name.startsWith(".") && item.name !== ".gitignore" && item.name !== ".env.example") continue;
      // Skip node_modules, dist, .git
      if (item.name === "node_modules" || item.name === ".git") continue;

      if (item.isDirectory()) {
        entries.push({ name: item.name, type: "directory" });
      } else if (item.isFile()) {
        try {
          const st = statSync(join(targetDir, item.name));
          entries.push({ name: item.name, type: "file", size: st.size });
        } catch {
          entries.push({ name: item.name, type: "file" });
        }
      }
    }
  } catch {
    // Directory unreadable
  }

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

/** Read file content with path traversal protection and size limit */
export function getFileContent(projectPath: string, filePath: string): FileContentResponse {
  const fullPath = resolve(projectPath, filePath);

  // Path traversal protection
  if (!fullPath.startsWith(projectPath + "/")) {
    throw new Error("Path traversal blocked");
  }

  const st = statSync(fullPath);
  const truncated = st.size > MAX_FILE_SIZE;
  const readSize = truncated ? MAX_FILE_SIZE : st.size;

  let content: string;
  if (truncated) {
    const buf = Buffer.alloc(readSize);
    const fd = openSync(fullPath, "r");
    try {
      readSync(fd, buf, 0, readSize, 0);
      content = buf.toString("utf-8");
    } finally {
      closeSync(fd);
    }
  } else {
    content = readFileSync(fullPath, "utf-8");
  }

  return {
    content,
    language: detectLanguage(filePath),
    size: st.size,
    truncated,
  };
}
