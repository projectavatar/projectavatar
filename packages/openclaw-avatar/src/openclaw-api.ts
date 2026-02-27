/**
 * Minimal local type stubs for the OpenClaw Plugin API.
 *
 * The full types live in `openclaw/plugin-sdk` (a peer dependency, only
 * available at runtime). These stubs cover exactly what this plugin uses
 * so TypeScript is happy without requiring the peer to be installed at
 * build time.
 *
 * When openclaw is installed as a peer, the real types win via declaration
 * merging. When building standalone (e.g. in CI without openclaw), these
 * stubs keep the build clean.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = any;

export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type OpenClawPluginToolOptions = {
  name?: string;
  optional?: boolean;
};

// ── Hook event shapes (subset used by this plugin) ──────────────────────────

export type MessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
};



export type BeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
};

export type BeforeToolCallResult = {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
};

export type AfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
};

export type AgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
};



export type SessionEndEvent = {
  sessionId: string;
  messageCount: number;
  durationMs?: number;
};

// ── Hook map ────────────────────────────────────────────────────────────────

type AnyCtx = Record<string, unknown>;

export type PluginHookHandlerMap = {
  message_received:    (event: MessageReceivedEvent,    ctx: AnyCtx) => void | Promise<void>;
  before_tool_call:    (event: BeforeToolCallEvent,     ctx: AnyCtx) => BeforeToolCallResult | void | Promise<BeforeToolCallResult | void>;
  after_tool_call:     (event: AfterToolCallEvent,      ctx: AnyCtx) => void | Promise<void>;
  agent_end:           (event: AgentEndEvent,           ctx: AnyCtx) => void | Promise<void>;
  session_end:         (event: SessionEndEvent,         ctx: AnyCtx) => void | Promise<void>;
};

export type PluginHookName = keyof PluginHookHandlerMap;

// ── Plugin API ───────────────────────────────────────────────────────────────

export type CommandHandler = (args: string[]) => string | Promise<string>;

export type OpenClawPluginApi = {
  id: string;
  name: string;
  version?: string;
  source: string;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  registerTool: (tool: AnyTool, opts?: OpenClawPluginToolOptions) => void;
  /**
   * Register a slash command accessible via `/commandName [args...]`.
   * Takes a single command definition object.
   */
  registerCommand: (command: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    requireAuth?: boolean;
    handler: CommandHandler;
  }) => void;
  on: <K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    opts?: { priority?: number },
  ) => void;
  resolvePath: (input: string) => string;
};

export type OpenClawPluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
  activate?: (api: OpenClawPluginApi) => void | Promise<void>;
};
