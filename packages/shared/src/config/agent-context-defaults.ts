/**
 * Agent Context default paths
 *
 * Kept in a dependency-free leaf module (no `fs`/`path` imports) so the renderer
 * can import these constants without pulling node built-ins into the browser
 * bundle. Re-exported from preferences.ts for prompt/main-process consumers.
 */

/**
 * Default path for the global agent context file (auto-injected into the system
 * prompt across all projects). Supports ~/$HOME expansion via expandPath().
 */
export const DEFAULT_AGENT_CONTEXT_GLOBAL_PATH = '$HOME/.agents/AGENTS.md';

/**
 * Default path for the per-project agent context file (auto-injected into the
 * system prompt for the active session). Resolved relative to the session
 * working directory.
 */
export const DEFAULT_AGENT_CONTEXT_PROJECT_PATH = 'AGENTS.md';
