import { BrowserWindow, dialog } from "electron";
import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "fs";
import { getDatabase } from "./database";
import { safeHandle } from "./safe-handle";
import { broadcastToMobile } from "./ws-server";
import {
  DEFAULT_PROJECT_CONFIG,
  type ProjectConfig,
  type ProjectWorkspaceMetadata,
  type ThinkingEffort,
} from "../shared/types";
import {
  addProjectSource,
  ensureLegacyProjectSource,
  listProjectSources,
  primarySourcePath,
  removeProjectRepository,
  removeProjectSource,
  rescanProjectSources,
  setPrimarySourcePath,
} from './project-sources'
import { normalizeProjectColor, PROJECT_COLOR_NAMES } from '../shared/project-colors'
import { normalizeCapabilityProfile } from './capability-service'

export { DEFAULT_PROJECT_CONFIG };

const THINKING_EFFORTS = new Set<ThinkingEffort>(['low', 'medium', 'high', 'max', 'disabled']);

const CODING_MARKERS = [
  'package.json',
  'tsconfig.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'Gemfile',
  'composer.json',
  'Makefile',
  'src',
] as const

export const PROJECT_COLORS = PROJECT_COLOR_NAMES;

function parseBranchFromStatus(statusOutput: string): string | null {
  const header = statusOutput.split('\n').find((line) => line.startsWith('## '))
  if (!header) return null
  const branch = header.slice(3).split('...')[0]?.trim()
  return branch || null
}

export function detectProjectWorkspaceMetadata(rootDirectory: string): ProjectWorkspaceMetadata | null {
  const trimmedRoot = rootDirectory.trim()
  if (!trimmedRoot) return null

  const scannedAt = Date.now()
  if (!existsSync(trimmedRoot)) {
    return {
      rootDirectory: trimmedRoot,
      exists: false,
      isLikelyCodingWorkspace: false,
      codingMarkers: [],
      isGitRepo: false,
      repoRoot: null,
      branch: null,
      dirty: false,
      scannedAt,
    }
  }

  try {
    if (!statSync(trimmedRoot).isDirectory()) {
      return {
        rootDirectory: trimmedRoot,
        exists: false,
        isLikelyCodingWorkspace: false,
        codingMarkers: [],
        isGitRepo: false,
        repoRoot: null,
        branch: null,
        dirty: false,
        scannedAt,
      }
    }
  } catch {
    return {
      rootDirectory: trimmedRoot,
      exists: false,
      isLikelyCodingWorkspace: false,
      codingMarkers: [],
      isGitRepo: false,
      repoRoot: null,
      branch: null,
      dirty: false,
      scannedAt,
    }
  }

  const entries = new Set(readdirSync(trimmedRoot))
  const codingMarkers = CODING_MARKERS.filter((marker) => entries.has(marker))

  let repoRoot: string | null = null
  let branch: string | null = null
  let dirty = false
  let isGitRepo = false

  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: trimmedRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim() || null
    const statusOutput = execFileSync('git', ['status', '--porcelain=v1', '-b'], {
      cwd: trimmedRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    isGitRepo = true
    branch = parseBranchFromStatus(statusOutput)
    dirty = statusOutput
      .split('\n')
      .filter(Boolean)
      .some((line) => !line.startsWith('## '))
  } catch {
    isGitRepo = false
  }

  return {
    rootDirectory: trimmedRoot,
    exists: true,
    isLikelyCodingWorkspace: codingMarkers.length > 0,
    codingMarkers,
    isGitRepo,
    repoRoot,
    branch,
    dirty,
    scannedAt,
  }
}

export function parseProjectConfig(
  configJson: string | null,
): ProjectConfig {
  if (!configJson) return { ...DEFAULT_PROJECT_CONFIG };
  try {
    const raw = JSON.parse(configJson) as Record<string, unknown>;
    // Defensive: rootDirectory may have been stored as an array (dialog returns filePaths array)
    if (Array.isArray(raw.rootDirectory)) {
      raw.rootDirectory = typeof raw.rootDirectory[0] === 'string' ? raw.rootDirectory[0] : '';
    }
    // Strip embedded newlines that can corrupt a path if instructions text was accidentally merged
    if (typeof raw.rootDirectory === 'string' && raw.rootDirectory.includes('\n')) {
      raw.rootDirectory = raw.rootDirectory.split('\n')[0]?.trim() ?? ''
    }
    // 'manual-delegation' is the pre-rename value (this mode was "Manual Workflow" before it
    // became "Automated Workflow") — accepted here so old project rows self-heal on next load
    // without a dedicated migration pass, since workflowMode lives in a JSON blob, not a column.
    const workflowMode = raw.workflowMode === 'automated-delegation' || raw.workflowMode === 'manual-delegation' || raw.workflowMode === 'orchestrated' || raw.workflowMode === 'single-agent'
      ? (raw.workflowMode === 'manual-delegation' ? 'automated-delegation' : raw.workflowMode)
      : (raw.orchestrationEnabled === true ? 'orchestrated' : 'single-agent')
    raw.workflowMode = workflowMode
    raw.orchestrationEnabled = workflowMode === 'orchestrated'
    raw.codingWorkspace = raw.codingWorkspace === true
    raw.defaultThinkingEffort = typeof raw.defaultThinkingEffort === 'string' && THINKING_EFFORTS.has(raw.defaultThinkingEffort as ThinkingEffort)
      ? raw.defaultThinkingEffort
      : null
    raw.sources = Array.isArray(raw.sources) ? raw.sources : []
    raw.repositories = Array.isArray(raw.repositories) ? raw.repositories : []
    if (typeof raw.workspaceInfo !== 'object' || raw.workspaceInfo === null) {
      raw.workspaceInfo = null
    }
    return { ...DEFAULT_PROJECT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_PROJECT_CONFIG };
  }
}

export function getProjectRootDirectory(projectId: string): string | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(projectId) as { config_json: string | null } | undefined;
  if (!row) return undefined;
  const parsed = parseProjectConfig(row.config_json)
  ensureLegacyProjectSource(db, projectId, parsed.rootDirectory)
  const rootDirectory = primarySourcePath(listProjectSources(db, projectId)) || parsed.rootDirectory;
  return rootDirectory && rootDirectory.trim() ? rootDirectory.trim() : undefined;
}

function hydrateProjectHierarchy(db: ReturnType<typeof getDatabase>, projectId: string, config: ProjectConfig): ProjectConfig {
  ensureLegacyProjectSource(db, projectId, config.rootDirectory)
  const hierarchy = listProjectSources(db, projectId)
  return { ...config, ...hierarchy, rootDirectory: primarySourcePath(hierarchy) || config.rootDirectory }
}

/**
 * The same view of a project's config that `project:get-config` returns. Exported so writers
 * outside this module (notably the project capability handlers) can broadcast a config change
 * to mobile with the identical, hydrated payload rather than a partial one.
 */
export function readProjectConfig(db: ReturnType<typeof getDatabase>, projectId: string): ProjectConfig {
  const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(projectId) as
    { config_json: string | null } | undefined
  return hydrateProjectHierarchy(db, projectId, parseProjectConfig(row?.config_json ?? null))
}

function normalizeProjectConfigPatch(config: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...config }
  if (Array.isArray(normalized.rootDirectory)) {
    normalized.rootDirectory = typeof normalized.rootDirectory[0] === 'string' ? normalized.rootDirectory[0] : '';
  }
  if (typeof normalized.rootDirectory === 'string' && normalized.rootDirectory.includes('\n')) {
    normalized.rootDirectory = normalized.rootDirectory.split('\n')[0]?.trim() ?? ''
  }
  const workflowMode =
    normalized.workflowMode === 'automated-delegation' || normalized.workflowMode === 'manual-delegation' || normalized.workflowMode === 'orchestrated' || normalized.workflowMode === 'single-agent'
      ? (normalized.workflowMode === 'manual-delegation' ? 'automated-delegation' : normalized.workflowMode)
      : typeof normalized.orchestrationEnabled === 'boolean'
        ? (normalized.orchestrationEnabled ? 'orchestrated' : 'single-agent')
        : undefined
  if (workflowMode) {
    normalized.workflowMode = workflowMode
    normalized.orchestrationEnabled = workflowMode === 'orchestrated'
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'workspaceInfo')) {
    normalized.workspaceInfo = normalized.workspaceInfo && typeof normalized.workspaceInfo === 'object'
      ? normalized.workspaceInfo
      : null
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'capabilityProfile')) {
    // Keep this writer in step with `project:set-capabilities`. Without it a generic config
    // patch could persist an unvalidated capability blob that the capability reader then
    // silently discards, which reads to the user as a save that did nothing.
    normalized.capabilityProfile = normalizeCapabilityProfile(normalized.capabilityProfile)
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'defaultThinkingEffort')) {
    normalized.defaultThinkingEffort = typeof normalized.defaultThinkingEffort === 'string' && THINKING_EFFORTS.has(normalized.defaultThinkingEffort as ThinkingEffort)
      ? normalized.defaultThinkingEffort
      : null
  }
  return normalized
}

export function registerProjectHandlers(): void {
  const db = getDatabase();

  safeHandle("project:list", () => {
    const rows = db
      .prepare("SELECT * FROM projects ORDER BY name ASC")
      .all() as Array<{
      id: string;
      name: string;
      color: string;
      default_model: string | null;
      config_json: string | null;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((r) => ({
      ...r,
      config: hydrateProjectHierarchy(db, r.id, parseProjectConfig(r.config_json)),
      config_json: undefined,
    }));
  });

  safeHandle("project:create", (_event, name: string, color: string) => {
    const safeName = String(name).trim().slice(0, 100);
    const safeColor = normalizeProjectColor(color) ?? "blue";
    if (!safeName) throw new Error("Project name is required");
    const id = randomUUID();
    const now = Date.now();
    const defaultConfig = JSON.stringify(DEFAULT_PROJECT_CONFIG);
    db.prepare(
      "INSERT INTO projects (id, name, color, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, safeName, safeColor, defaultConfig, now, now);
    return {
      id,
      name: safeName,
      color: safeColor,
      config: { ...DEFAULT_PROJECT_CONFIG },
      created_at: now,
      updated_at: now,
    };
  });

  safeHandle("project:rename", (_event, id: string, name: string, color?: string) => {
    const safeName = String(name).trim().slice(0, 100);
    if (!safeName) throw new Error("Project name is required");
    const safeColor = color === undefined ? undefined : normalizeProjectColor(color);
    if (safeColor === null) throw new Error("Invalid project color");
    if (safeColor) {
      db.prepare("UPDATE projects SET name = ?, color = ?, updated_at = ? WHERE id = ?").run(
        safeName,
        safeColor,
        Date.now(),
        id,
      );
    } else {
      db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(
        safeName,
        Date.now(),
        id,
      );
    }
    broadcastToMobile({ event: "project:renamed", data: { id, name: safeName, ...(safeColor ? { color: safeColor } : {}) } });
    return true;
  });

  safeHandle("project:delete", (_event, id: string, deleteChats?: boolean) => {
    if (deleteChats) {
      db.prepare("DELETE FROM conversations WHERE project_id = ?").run(id);
    }
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return true;
  });

  safeHandle("project:duplicate", (_event, id: string) => {
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          color: string;
          config_json: string | null;
          default_model: string | null;
          project_hermes_profile: string | null;
        }
      | undefined;
    if (!row) return null;
    const newId = randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO projects (id, name, color, config_json, default_model, project_hermes_profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      newId,
      `${row.name} (copy)`,
      row.color,
      row.config_json,
      row.default_model,
      row.project_hermes_profile,
      now,
      now,
    );
    return {
      id: newId,
      name: `${row.name} (copy)`,
      color: row.color,
      default_model: row.default_model,
      project_hermes_profile: row.project_hermes_profile,
      created_at: now,
      updated_at: now,
    };
  });

  safeHandle("project:export", async (_event, id: string) => {
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          color: string;
          config_json: string | null;
          default_model: string | null;
          project_hermes_profile: string | null;
        }
      | undefined;
    if (!row) return false;
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${row.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const data = {
      name: row.name,
      color: row.color,
      default_model: row.default_model,
      project_hermes_profile: row.project_hermes_profile,
      config: row.config_json ? JSON.parse(row.config_json) : {},
    };
    writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  });

  safeHandle(
    "project:set-conversation",
    (_event, conversationId: string, projectId: string | null) => {
      db.prepare(
        "UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?",
      ).run(projectId ?? null, Date.now(), conversationId);
      return true;
    },
  );

  safeHandle(
    "project:set-default-model",
    (_event, id: string, model: string | null, hermesProfile?: string | null) => {
      const normalizedModel = model && model !== "default" ? model : null;
      const normalizedProfile = normalizedModel && hermesProfile?.trim() ? hermesProfile.trim() : null;
      db.prepare(
        "UPDATE projects SET default_model = ?, project_hermes_profile = ?, updated_at = ? WHERE id = ?",
      ).run(normalizedModel, normalizedProfile, Date.now(), id);
      const row = db.prepare("SELECT config_json FROM projects WHERE id = ?").get(id) as
        { config_json: string | null } | undefined;
      broadcastToMobile({
        event: "project:config-changed",
        data: {
          id,
          config: { ...parseProjectConfig(row?.config_json ?? null), defaultModel: normalizedModel, projectHermesProfile: normalizedProfile },
        },
      });
      return true;
    },
  );

  safeHandle(
    "project:update-config",
    (_event, id: string, config: Record<string, unknown>) => {
      const existing = db
        .prepare("SELECT config_json FROM projects WHERE id = ?")
        .get(id) as { config_json: string | null } | undefined;
      const currentConfig = parseProjectConfig(existing?.config_json ?? null)
      const normalizedPatch = normalizeProjectConfigPatch(config)
      const merged = { ...currentConfig, ...normalizedPatch } as ProjectConfig
      if ('rootDirectory' in normalizedPatch) {
        merged.workspaceInfo = detectProjectWorkspaceMetadata(merged.rootDirectory)
        if (merged.rootDirectory.trim()) {
          setPrimarySourcePath(db, id, merged.rootDirectory)
        }
      }
      const hydrated = hydrateProjectHierarchy(db, id, merged)
      db.prepare(
        "UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify(hydrated), Date.now(), id);
      // Distinct from the WS-originated "project:config-updated" ack (which Android
      // treats as "my own save finished, close this screen"). This event just tells
      // Android something changed remotely so it can silently refresh if safe to do so.
      broadcastToMobile({ event: "project:config-changed", data: { id, config: hydrated } });
      return true;
    },
  );

  safeHandle("project:get-config", (_event, id: string) => {
    const row = db
      .prepare("SELECT config_json FROM projects WHERE id = ?")
      .get(id) as { config_json: string | null } | undefined;
    return hydrateProjectHierarchy(db, id, parseProjectConfig(row?.config_json ?? null));
  });

  safeHandle("project:inspect-workspace", (_event, rootDirectory: string) => {
    return detectProjectWorkspaceMetadata(String(rootDirectory ?? ''))
  })

  safeHandle('project:list-sources', (_event, projectId: string) => {
    const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(projectId) as { config_json: string | null } | undefined
    if (!row) throw new Error('Project not found')
    ensureLegacyProjectSource(db, projectId, parseProjectConfig(row.config_json).rootDirectory)
    return listProjectSources(db, projectId)
  })

  safeHandle('project:add-source', async (_event, projectId: string, input: { label?: string; localPath: string }) => {
    const hierarchy = await addProjectSource(db, projectId, input)
    persistHierarchy(projectId, hierarchy)
    return hierarchy
  })

  safeHandle('project:remove-source', (_event, projectId: string, sourceId: string) => {
    const hierarchy = removeProjectSource(db, projectId, sourceId)
    persistHierarchy(projectId, hierarchy)
    return hierarchy
  })

  safeHandle('project:remove-repository', (_event, projectId: string, repositoryId: string) => {
    const hierarchy = removeProjectRepository(db, projectId, repositoryId)
    persistHierarchy(projectId, hierarchy)
    return hierarchy
  })

  safeHandle('project:rescan-sources', async (_event, projectId: string) => {
    const hierarchy = await rescanProjectSources(db, projectId)
    persistHierarchy(projectId, hierarchy)
    return hierarchy
  })

  function persistHierarchy(projectId: string, hierarchy: ReturnType<typeof listProjectSources>): void {
    const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(projectId) as { config_json: string | null } | undefined
    const config = { ...parseProjectConfig(row?.config_json ?? null), ...hierarchy, rootDirectory: primarySourcePath(hierarchy) }
    db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(config), Date.now(), projectId)
    broadcastToMobile({ event: 'project:config-changed', data: { id: projectId, config } })
  }
}

export function registerProjectAgentHandlers(): void {
  const db = getDatabase();

  safeHandle("project:list-agents", (_event, projectId: string) => {
    const rows = db
      .prepare(
        "SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC",
      )
      .all(projectId) as {
      agent_id: string;
      config_json: string;
      is_primary: number;
      sort_order: number;
    }[];
    return rows.map((r) => {
      const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string };
      return {
        agentId: r.agent_id,
        agentName: cfg.name ?? "",
        agentIcon: cfg.icon ?? "",
        isPrimary: r.is_primary === 1,
        sortOrder: r.sort_order,
      };
    });
  });

  safeHandle(
    "project:add-agent",
    (_event, projectId: string, agentId: string) => {
      db.prepare(
        "INSERT OR IGNORE INTO project_agents (project_id, agent_id, is_primary, sort_order, added_at) VALUES (?, ?, 0, 0, ?)",
      ).run(projectId, agentId, Date.now());
      return true;
    },
  );

  safeHandle(
    "project:remove-agent",
    (_event, projectId: string, agentId: string) => {
      db.prepare(
        "DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?",
      ).run(projectId, agentId);
      return true;
    },
  );

  safeHandle(
    "project:set-primary-agent",
    (_event, projectId: string, agentId: string) => {
      const setPrimary = db.transaction(() => {
        db.prepare(
          "UPDATE project_agents SET is_primary = 0 WHERE project_id = ?",
        ).run(projectId);
        db.prepare(
          "UPDATE project_agents SET is_primary = 1 WHERE project_id = ? AND agent_id = ?",
        ).run(projectId, agentId);
      });
      setPrimary();
      return true;
    },
  );

  safeHandle(
    "project:reorder-agents",
    (_event, projectId: string, orderedAgentIds: string[]) => {
      const update = db.prepare(
        "UPDATE project_agents SET sort_order = ? WHERE project_id = ? AND agent_id = ?",
      );
      const reorder = db.transaction(() => {
        orderedAgentIds.forEach((agentId, index) => {
          update.run(index, projectId, agentId);
        });
      });
      reorder();
      return true;
    },
  );
}
