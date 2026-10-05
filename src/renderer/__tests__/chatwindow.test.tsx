import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatWindow } from "../../renderer/components/ChatWindow";
import { setupMockApi, type MockApi } from "../../test/mocks/api";
import { createMockAppStore, setupStoreMock } from "../../test/mocks/store";
import type { ActiveChatTurnSnapshot, ChatTurnEvent } from "../../shared/chat-turn-types";

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn(),
}));

vi.mock("../../renderer/store/app-store", () => ({
  useAppStore,
}));

let mockApi: MockApi;
let streamErrorCallback:
  | ((error: {
      type: string;
      message: string;
      retryable: boolean;
      retryAfterSeconds?: number;
    }) => void)
  | null = null;
// useChat.ts registers two independent onChatTurnEvent subscribers (the reducer via
// useChatLiveTurn, plus a raw background-bookkeeping listener) — fan events out to
// every subscriber like the real (multi-listener) IPC bridge would, instead of
// capturing only the last registration.
let chatTurnEventCallbacks: ((event: ChatTurnEvent) => void)[] = [];
function emitChatTurnEvent(event: ChatTurnEvent) {
  act(() => {
    for (const cb of chatTurnEventCallbacks) cb(event);
  });
}
let autoClipboardFocusCallback: (() => void | Promise<void>) | null = null;
let mockStore: ReturnType<typeof createMockAppStore>;

beforeEach(() => {
  mockApi = setupMockApi();
  streamErrorCallback = null;
  chatTurnEventCallbacks = [];
  autoClipboardFocusCallback = null;
  mockApi.getMessages.mockResolvedValue([]);

  mockApi.onStreamError.mockImplementation(
    (
      cb: (error: {
        type: string;
        message: string;
        retryable: boolean;
        retryAfterSeconds?: number;
      }) => void,
    ) => {
      streamErrorCallback = cb;
      return () => {
        streamErrorCallback = null;
      };
    },
  );
  mockApi.onChatTurnEvent.mockImplementation((cb: (event: ChatTurnEvent) => void) => {
    chatTurnEventCallbacks.push(cb);
    return () => {
      chatTurnEventCallbacks = chatTurnEventCallbacks.filter((c) => c !== cb);
    };
  });
  mockApi.onAutoClipboardFocus.mockImplementation((cb: () => void | Promise<void>) => {
    autoClipboardFocusCallback = cb;
    return () => {
      autoClipboardFocusCallback = null;
    };
  });
  mockStore = createMockAppStore({
    authState: { authenticated: true, user: null },
  });
  setupStoreMock(useAppStore, mockStore);

  // useStreamingQueue reveals text via requestAnimationFrame, which isn't reliably
  // driven in this test environment. Report prefers-reduced-motion so enqueue()
  // deposits content synchronously — these tests care about render/lifecycle
  // behavior, not the reveal animation itself (covered in chat-animation.test.ts).
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatWindow — Empty State", () => {
  it("chat-r-1: shows welcome message with default title", () => {
    render(<ChatWindow />);
    expect(screen.getByText("Nexy")).toBeInTheDocument();
  });

  it("chat-r-1b: shows agent name when activeAgent provided", () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      agents: [{ id: "a1", name: "Code Helper", icon: "🧑‍💻" }],
      activeAgentId: "a1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);
    expect(screen.getByText("🧑‍💻 Code Helper")).toBeInTheDocument();
  });

  it("chat-r-9: empty input does not send", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const sendButton = screen.getByRole("button", { name: /send/i });
    await user.click(sendButton);
    expect(mockApi.sendMessage).not.toHaveBeenCalled();
  });

  it("preserves a new chat draft when opening capabilities materializes a conversation", async () => {
    const user = userEvent.setup();
    mockApi.createConversation.mockResolvedValue({ id: "conv-capabilities" });
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
    });
    mockStore.conversationCreated.mockImplementation(async (id: string) => {
      (mockStore as { currentConversationId: string | null }).currentConversationId = id;
    });
    setupStoreMock(useAppStore, mockStore);

    const view = render(<ChatWindow />);
    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Keep this draft");
    await user.click(screen.getByRole("button", { name: "Chat capabilities" }));

    view.rerender(<ChatWindow />);
    await waitFor(() => expect(textarea).toHaveValue("Keep this draft"));
    expect(mockStore.conversationCreated).toHaveBeenCalledWith("conv-capabilities");
  });
});

describe("ChatWindow — Sending Messages", () => {
  it("keeps a new chat's Claude mode selected while its generated conversation row is loading", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: {
        authenticated: false,
        mode: "none",
        user: null,
        cliInstalled: true,
        clis: { claude: true, codex: false },
      },
      currentConversationId: null as string | null,
    });
    setupStoreMock(useAppStore, mockStore);
    const view = render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: /chat mode settings/i }));
    const claudeSection = screen.getByText("Claude Code mode (this chat)").parentElement!;
    const bypass = within(claudeSection).getByRole("button", { name: "Bypass" });
    await user.click(bypass);
    expect(bypass).toHaveClass("bg-purple-500");

    (mockStore as { currentConversationId: string | null }).currentConversationId = "conv-generated";
    view.rerender(<ChatWindow />);

    expect(screen.getByRole("button", { name: /chat mode settings/i })).toHaveClass("bg-blue-50");
  });

  it("waits for an in-flight mode update before launching the turn", async () => {
    const user = userEvent.setup();
    let resolveModeWrite!: (value: true) => void;
    mockApi.setConversationMode.mockReturnValue(new Promise((resolve) => {
      resolveModeWrite = resolve;
    }));
    mockStore = createMockAppStore({
      authState: {
        authenticated: true,
        mode: "none",
        user: null,
        cliInstalled: true,
        clis: { claude: false, codex: true },
      },
      currentConversationId: "conv-1",
      conversations: [{
        id: "conv-1",
        title: "Codex chat",
        project_id: null,
        model: "gpt-5.5",
        cli_backend: "codex-cli",
        pinned: false,
        created_at: 0,
        updated_at: 0,
      }],
      availableModelGroups: [{
        sourceKey: "codex-cli",
        sourceLabel: "Codex CLI",
        sourceType: "cli",
        models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
      }],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: /chat mode settings/i }));
    const sandboxSection = screen.getByText("Codex sandbox (this chat)").parentElement!;
    const workspace = within(sandboxSection).getByRole("button", { name: "Workspace" });
    await user.click(workspace);
    // The conversation list still contains the preceding null override while IPC is pending.
    // The optimistic choice must remain visible instead of snapping back to Default.
    expect(workspace).toHaveClass("bg-purple-500");

    await user.type(screen.getByRole("textbox", { name: /message input/i }), "Apply the fix");
    await user.click(screen.getByRole("button", { name: /^send message$/i }));

    expect(mockApi.setConversationMode).toHaveBeenCalledWith("conv-1", { cliModeOverride: "workspace-write" });
    expect(mockApi.sendMessage).not.toHaveBeenCalled();

    await act(async () => resolveModeWrite(true));
    await waitFor(() => expect(mockApi.sendMessage).toHaveBeenCalledTimes(1));
  });

  it("does not reset a persisted Claude permission mode when sending", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: {
        authenticated: false,
        mode: "none",
        user: null,
        cliInstalled: true,
        clis: { claude: true, codex: false },
      },
      currentConversationId: "conv-claude",
      conversations: [{
        id: "conv-claude",
        title: "Claude chat",
        project_id: null,
        model: "claude-sonnet-4-6",
        cli_backend: "claude-cli",
        cli_mode_override: "bypassPermissions",
        pinned: false,
        created_at: 0,
        updated_at: 0,
      }],
      availableModelGroups: [{
        sourceKey: "claude-cli",
        sourceLabel: "Claude CLI",
        sourceType: "cli",
        models: [{ id: "claude-sonnet-4-6", label: "Claude Sonnet" }],
      }],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    await user.type(screen.getByRole("textbox", { name: /message input/i }), "Continue the task");
    await user.click(screen.getByRole("button", { name: /^send message$/i }));

    await waitFor(() => expect(mockApi.sendMessage).toHaveBeenCalledTimes(1));
    expect(mockApi.setConversationMode).not.toHaveBeenCalled();
    expect(mockApi.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({
      cliModeOverride: undefined,
    }));
  });

  it("waits for an in-flight model update before launching the turn", async () => {
    const user = userEvent.setup();
    let resolveModelWrite!: (value: true) => void;
    mockApi.setConversationModel.mockReturnValue(new Promise((resolve) => {
      resolveModelWrite = resolve;
    }));
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [{
        id: "conv-1",
        title: "Existing chat",
        project_id: null,
        model: "gpt-old",
        pinned: false,
        created_at: 0,
        updated_at: 0,
      }],
      availableModelGroups: [{
        sourceKey: "openai",
        sourceLabel: "OpenAI",
        sourceType: "provider",
        models: [
          { id: "gpt-old", label: "GPT old" },
          { id: "gpt-new", label: "GPT new" },
        ],
      }],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: /conversation model/i }));
    await user.click(screen.getByText("GPT new"));
    expect(screen.getByRole("button", { name: /conversation model/i })).toHaveTextContent("gpt-new");

    await user.type(screen.getByRole("textbox", { name: /message input/i }), "Use the new model");
    await user.click(screen.getByRole("button", { name: /^send message$/i }));
    expect(mockApi.sendMessage).not.toHaveBeenCalled();

    await act(async () => resolveModelWrite(true));
    await waitFor(() => expect(mockApi.sendMessage).toHaveBeenCalledTimes(1));
    expect(mockApi.sendMessage.mock.calls[0]?.[2]).toMatchObject({ model: "gpt-new" });
  });

  it("chat-r-3: user message appears immediately after send (optimistic)", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Hello world");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("chat-r-8: Enter sends message, Shift+Enter inserts newline", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Line 1{Shift>}{Enter}{/Shift}Line 2");

    expect(mockApi.sendMessage).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("Line 1\nLine 2");

    await user.type(textarea, "{Enter}");

    expect(mockStore.conversationCreated).toHaveBeenCalled();
  });

  it("chat-r-6: send button disabled while isGenerating", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Test message");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^send$/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ChatWindow — Streaming", () => {
  it("chat-r-4: streaming content renders with typing indicator", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Test");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(
      screen.getByText(/Thinking(\.\.\.|( · \d+s))/),
    ).toBeInTheDocument();

    emitChatTurnEvent({ type: "turn_started", conversationId: "conv-1", turnId: "turn-1", sequence: 1, timestamp: 1 });
    emitChatTurnEvent({
      type: "assistant_text_delta", conversationId: "conv-1", turnId: "turn-1", sequence: 2, timestamp: 2, chunk: "Hello ",
    });
    emitChatTurnEvent({
      type: "assistant_text_delta", conversationId: "conv-1", turnId: "turn-1", sequence: 3, timestamp: 3, chunk: "world",
    });

    await waitFor(() => {
      expect(screen.getByText(/Hello world/)).toBeInTheDocument();
    });
    expect(screen.getByText("▊")).toBeInTheDocument();
  });

  it("chat-r-5: stream end appends final message and clears streaming", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Test");
    await user.click(screen.getByRole("button", { name: /send/i }));

    emitChatTurnEvent({ type: "turn_started", conversationId: "conv-1", turnId: "turn-1", sequence: 1, timestamp: 1 });
    emitChatTurnEvent({
      type: "assistant_text_delta", conversationId: "conv-1", turnId: "turn-1", sequence: 2, timestamp: 2, chunk: "Response text",
    });
    emitChatTurnEvent({ type: "turn_completed", conversationId: "conv-1", turnId: "turn-1", sequence: 3, timestamp: 3 });

    await waitFor(() => {
      expect(screen.getByText("Response text")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    expect(screen.queryByText("▊")).not.toBeInTheDocument();
  });

  it("chat-r-7: stop button visible while generating", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: 'conv-1',
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "Test");
    await user.click(screen.getByRole("button", { name: /send/i }));

    const stopBtn = screen.getByRole("button", { name: /stop/i });
    expect(stopBtn).toBeInTheDocument();

    await user.click(stopBtn);
    expect(mockApi.stopGeneration).toHaveBeenCalledWith('conv-1');
  });

  it("keeps Send available after stop and a model change when a stale active-turn snapshot arrives", async () => {
    const user = userEvent.setup();
    let resolveActiveTurn!: (snapshot: ActiveChatTurnSnapshot | null) => void;
    mockApi.getActiveChatTurn.mockReturnValue(new Promise((resolve) => {
      resolveActiveTurn = resolve;
    }));
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [{
        id: "conv-1",
        title: "Chat",
        project_id: null,
        agent_id: null,
        model: null,
        pinned: false,
        created_at: 0,
        updated_at: 0,
      }],
      availableModelGroups: [{
        sourceKey: "openai",
        sourceLabel: "OpenAI",
        sourceType: "provider",
        models: [{ id: "gpt-5-mini", label: "GPT-5 mini" }],
      }],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "First request");
    await user.click(screen.getByRole("button", { name: /^send message$/i }));
    await user.click(screen.getByRole("button", { name: /stop generating/i }));

    await user.click(screen.getByRole("button", { name: /conversation model/i }));
    await user.click(await screen.findByText("GPT-5 mini"));
    expect(mockApi.setConversationModel).toHaveBeenCalledWith("conv-1", "gpt-5-mini", null, null);

    await act(async () => {
      resolveActiveTurn({
        conversationId: "conv-1",
        turnId: "stale-turn",
        latestSequence: 1,
        assistantText: "",
        status: "active",
        toolCalls: [],
        activity: null,
        events: [],
      });
      await Promise.resolve();
    });

    await user.type(textarea, "Follow-up with the new model");
    expect(screen.getByRole("button", { name: /^send message$/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /stop generating/i })).not.toBeInTheDocument();
  });
});

describe("ChatWindow — Messages Display", () => {
  it("chat-r-2: messages render in chronological order", async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "First message", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "First reply", timestamp: 2000 },
      { id: "m3", role: "user", content: "Second message", timestamp: 3000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("First message")).toBeInTheDocument();
    });

    const messages = screen.getAllByText(/message|reply/i);
    expect(messages[0]).toHaveTextContent("First message");
    expect(messages[1]).toHaveTextContent("First reply");
    expect(messages[2]).toHaveTextContent("Second message");
  });

  it("opens fork-from-here configuration and forwards the selected target", async () => {
    const user = userEvent.setup();
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Fork at this point", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "Continue elsewhere", timestamp: 2000 },
    ]);
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      projects: [
        { id: "project-1", name: "Current project", color: "blue", created_at: 0, updated_at: 0 },
        { id: "project-2", name: "Different project", color: "green", created_at: 0, updated_at: 0 },
      ],
      availableModelGroups: [{
        sourceKey: "openai",
        sourceLabel: "OpenAI",
        sourceType: "provider",
        models: [{ id: "gpt-5.5", label: "GPT-5.5" }, { id: "gpt-4.1", label: "GPT-4.1" }],
      }],
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => expect(screen.getByText("Fork at this point")).toBeInTheDocument());
    fireEvent.mouseEnter(screen.getByText("Fork at this point").closest(".group")!);
    const forkButton = await screen.findByRole("button", { name: "Fork from here" });
    await user.click(forkButton);

    expect(screen.getByText("Fork the conversation up to this message into a new project or model.")).toBeInTheDocument();
    const modelButton = screen.getAllByRole("button", { name: /conversation model/i }).at(-1)!;
    await user.click(modelButton);
    await user.click(await screen.findByText("GPT-4.1"));

    const projectSelect = screen.getAllByRole("combobox").at(-1)!;
    await user.selectOptions(projectSelect, "project-2");
    const forkButtons = screen.getAllByRole("button", { name: "Fork from here" });
    await user.click(forkButtons[forkButtons.length - 1]);

    await waitFor(() => {
      expect(mockApi.forkConversation).toHaveBeenCalledWith("conv-1", {
        model: "gpt-4.1",
        agentId: null,
        projectId: "project-2",
        cutoffTimestamp: 1000,
      });
    });
  });

  it("shows a clickable request reference when the related user message is above the viewport", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Explain the renderer scroll behavior", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "The scroll container tracks message visibility.", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("The scroll container tracks message visibility.")).toBeInTheDocument();
    });

    const log = screen.getByRole("log", { name: /messages/i });
    const userMessage = document.querySelector('[data-message-id="m1"]') as HTMLDivElement;
    const assistantMessage = document.querySelector('[data-message-id="m2"]') as HTMLDivElement;

    vi.spyOn(log, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 800,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    vi.spyOn(userMessage, "getBoundingClientRect").mockReturnValue({
      top: -180,
      bottom: -80,
      left: 0,
      right: 800,
      width: 800,
      height: 100,
      x: 0,
      y: -180,
      toJSON: () => {},
    });
    vi.spyOn(assistantMessage, "getBoundingClientRect").mockReturnValue({
      top: 80,
      bottom: 300,
      left: 0,
      right: 800,
      width: 800,
      height: 220,
      x: 0,
      y: 80,
      toJSON: () => {},
    });

    fireEvent.scroll(log);

    const reference = await screen.findByRole("button", { name: "Scroll to related request" });
    expect(reference).toHaveTextContent("Explain the renderer scroll behavior");

    await userEvent.click(reference);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("hides the request reference when the related user message is visible", async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Visible request", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "Visible answer", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("Visible answer")).toBeInTheDocument();
    });

    const log = screen.getByRole("log", { name: /messages/i });
    const userMessage = document.querySelector('[data-message-id="m1"]') as HTMLDivElement;
    const assistantMessage = document.querySelector('[data-message-id="m2"]') as HTMLDivElement;

    vi.spyOn(log, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 800,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    vi.spyOn(userMessage, "getBoundingClientRect").mockReturnValue({
      top: 20,
      bottom: 120,
      left: 0,
      right: 800,
      width: 800,
      height: 100,
      x: 0,
      y: 20,
      toJSON: () => {},
    });
    vi.spyOn(assistantMessage, "getBoundingClientRect").mockReturnValue({
      top: 150,
      bottom: 300,
      left: 0,
      right: 800,
      width: 800,
      height: 150,
      x: 0,
      y: 150,
      toJSON: () => {},
    });

    fireEvent.scroll(log);

    expect(screen.queryByRole("button", { name: "Scroll to related request" })).not.toBeInTheDocument();
  });

  it("truncates long request previews in the request reference", async () => {
    const longRequest = "Summarize ".repeat(30);
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: longRequest, timestamp: 1000 },
      { id: "m2", role: "assistant", content: "Short answer", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("Short answer")).toBeInTheDocument();
    });

    const log = screen.getByRole("log", { name: /messages/i });
    const userMessage = document.querySelector('[data-message-id="m1"]') as HTMLDivElement;
    const assistantMessage = document.querySelector('[data-message-id="m2"]') as HTMLDivElement;

    vi.spyOn(log, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 800,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    vi.spyOn(userMessage, "getBoundingClientRect").mockReturnValue({
      top: -220,
      bottom: -120,
      left: 0,
      right: 800,
      width: 800,
      height: 100,
      x: 0,
      y: -220,
      toJSON: () => {},
    });
    vi.spyOn(assistantMessage, "getBoundingClientRect").mockReturnValue({
      top: 80,
      bottom: 260,
      left: 0,
      right: 800,
      width: 800,
      height: 180,
      x: 0,
      y: 80,
      toJSON: () => {},
    });

    fireEvent.scroll(log);

    const reference = await screen.findByRole("button", { name: "Scroll to related request" });
    expect(reference.textContent).toContain("...");
    expect(reference.textContent!.length).toBeLessThan(longRequest.length);
  });
});

describe("ChatWindow — File Attachments", () => {
  it("does not offer screen capture in the attachment actions", async () => {
    const user = userEvent.setup();

    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: "More message actions" }));
    expect(screen.queryByRole("menuitem", { name: /capture screen/i })).not.toBeInTheDocument();
  });

  it("chat-r-11: file attachment badge appears after file pick", async () => {
    const user = userEvent.setup();
    mockApi.openFileDialog.mockResolvedValue([
      { id: "f1", name: "test.ts", path: "/tmp/test.ts", size: 500 },
    ]);

    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: "More message actions" }));
    await user.click(screen.getByRole("menuitem", { name: /attach files/i }));

    await waitFor(() => {
      expect(screen.getByText(/test\.ts/)).toBeInTheDocument();
    });
  });

  it("chat-r-12: attachment removed when X clicked", async () => {
    const user = userEvent.setup();
    mockApi.openFileDialog.mockResolvedValue([
      { id: "f1", name: "test.ts", path: "/tmp/test.ts", size: 500 },
    ]);

    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: "More message actions" }));
    await user.click(screen.getByRole("menuitem", { name: /attach files/i }));

    await waitFor(() => {
      expect(screen.getByText(/test\.ts/)).toBeInTheDocument();
    });

    const removeBtn = screen.getByLabelText(/Remove/);
    await user.click(removeBtn);

    expect(screen.queryByText(/test\.ts/)).not.toBeInTheDocument();
  });
});

describe("ChatWindow — Auto Clipboard", () => {
  it("reads clipboard text on focus when enabled", async () => {
    mockApi.getSetting.mockResolvedValue('true');
    mockApi.readClipboardContent.mockResolvedValue({
      type: 'text',
      text: 'focused clipboard text',
    });

    render(<ChatWindow />);

    await act(async () => {
      await autoClipboardFocusCallback?.();
    });

    await waitFor(() => {
      expect(screen.getByText('@clipboard')).toBeInTheDocument();
    });
    expect(mockApi.getSetting).toHaveBeenCalledWith('autoClipboard');
    expect(mockApi.readClipboardContent).toHaveBeenCalled();
  });
});

describe("ChatWindow — Offline State", () => {
  it("chat-r-13: offline placeholder shown when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
    });

    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    expect(textarea).toHaveAttribute(
      "placeholder",
      expect.stringContaining("Offline"),
    );

    Object.defineProperty(navigator, "onLine", { value: true, writable: true });
  });

  it("chat-r-14: input disabled when offline", () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
    });

    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    expect(textarea).toBeDisabled();

    Object.defineProperty(navigator, "onLine", { value: true, writable: true });
  });

  it("disables input while rate limit countdown is active", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    emitChatTurnEvent({ type: "turn_started", conversationId: "conv-1", turnId: "turn-1", sequence: 1, timestamp: 1 });
    emitChatTurnEvent({
      conversationId: "conv-1",
      turnId: "turn-1",
      sequence: 2,
      type: "turn_failed",
      timestamp: Date.now(),
      errorType: "rate_limit",
      message: "Rate limited. Please wait a moment and try again.",
      retryable: true,
      retryAfterSeconds: 8,
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Rate limited — you can send again in 8s/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("textbox", { name: /message input/i }),
    ).toBeDisabled();
  });
});

describe("ChatWindow — Regenerate & Edit", () => {
  it("chat-r-15: regenerate button shown only on last assistant message", async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Question", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "Answer", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("Answer")).toBeInTheDocument();
    });

    expect(screen.getByText("Answer")).toBeInTheDocument();
  });

  it("chat-r-17: edit button shown on user messages", async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "My question", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "My answer", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("My question")).toBeInTheDocument();
    });

    expect(screen.getByText("My question")).toBeInTheDocument();
  });

  it("allows canceling edit mode and restores messages", async () => {
    const user = userEvent.setup();
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "My question", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "My answer", timestamp: 2000 },
    ]);

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("My question")).toBeInTheDocument();
      expect(screen.getByText("My answer")).toBeInTheDocument();
    });

    await user.dblClick(screen.getByText("My question"));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /message input/i })).toHaveValue("My question");
    });
    expect(screen.getByRole("button", { name: /cancel edit/i })).toBeInTheDocument();
    expect(screen.queryByText("My answer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel edit/i }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /message input/i })).toHaveValue("");
    });
    expect(screen.getByText("My answer")).toBeInTheDocument();
  });
});

describe("ChatWindow — Slash Commands", () => {
  it("executes /help locally and does not send to API", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/help");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.sendMessage).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText(/Available slash commands:/i),
      ).toBeInTheDocument();
    });
  });

  it("shows slash autocomplete and inserts selected command with Enter", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/h");

    expect(screen.getByRole("option", { name: /\/help/i })).toBeInTheDocument();
    await user.type(textarea, "{Enter}");

    expect(textarea).toHaveValue("/help ");
  });

  it("executes /clear by removing messages and calling deleteMessagesAfter", async () => {
    const user = userEvent.setup();
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Old message", timestamp: 1000 },
    ]);
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);
    await waitFor(() => {
      expect(screen.getByText("Old message")).toBeInTheDocument();
    });

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/clear");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.deleteMessagesAfter).toHaveBeenCalledWith("conv-1", 0);
    expect(screen.queryByText("Old message")).not.toBeInTheDocument();
  });

  it("deletes the selected message and everything after it after confirmation", async () => {
    const user = userEvent.setup();
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Keep this", timestamp: 1000 },
      { id: "m2", role: "assistant", content: "Delete this", timestamp: 2000 },
      { id: "m3", role: "user", content: "Delete this too", timestamp: 3000 },
    ]);
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);
    const target = (await screen.findByText("Delete this")).closest('[data-message-id="m2"]')!;
    await user.click(within(target as HTMLElement).getByRole("button", { name: "More message actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete from here" }));

    expect(screen.getByRole("dialog", { name: "Delete from here?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockApi.deleteMessagesAfter).toHaveBeenCalledWith("conv-1", 2000);
      expect(screen.queryByText("Delete this")).not.toBeInTheDocument();
      expect(screen.queryByText("Delete this too")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Keep this")).toBeInTheDocument();
  });

  it("transforms /explain into an instruction prompt and sends it", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/explain this function");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.sendMessage).toHaveBeenCalled();
    const sentContent = mockApi.sendMessage.mock.calls[0][1];
    expect(sentContent).toContain("Explain this code clearly and concisely.");
    expect(sentContent).toContain("this function");
  });

  it("executes /cwd and shows the current working directory", async () => {
    const user = userEvent.setup();
    mockApi.getWorkingDirectory.mockResolvedValue("C:\\Projects\\app");
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/cwd");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.getWorkingDirectory).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/C:\\Projects\\app/)).toBeInTheDocument();
    });
  });

  it("executes /cd and calls setWorkingDirectory", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/cd C:\\Work");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.setWorkingDirectory).toHaveBeenCalledWith("C:\\Work");
  });

  it("executes /copy and writes the last assistant message to clipboard", async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "assistant", content: "Final answer", timestamp: 1000 },
    ]);
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => {
      expect(screen.getByText("Final answer")).toBeInTheDocument();
    });

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/copy");
    await user.click(screen.getByLabelText("Send message"));

    expect(writeTextSpy).toHaveBeenCalledWith("Final answer");
    writeTextSpy.mockRestore();
  });

  it("executes /share file and saves markdown through IPC", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/share file");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.saveTextFile).toHaveBeenCalled();
  });

  it("executes /models and prints the available models list", async () => {
    const user = userEvent.setup();
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/models");
    await user.click(screen.getByLabelText("Send message"));

    const systemMessage = await waitFor(() => {
      const el = screen.getByText(/Available models:/).closest('[data-message-role="system"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // System messages now render through the markdown pipeline (see MessageBubble.tsx) so a
    // leading "* " list marker becomes a real <li> bullet rather than literal text, and "Global
    // default" also appears elsewhere on the page (the model picker) — scope to this message's
    // own container rather than a page-wide text query.
    expect(within(systemMessage).getByText(/Global default/)).toBeInTheDocument();
  });

  it("executes /model and sets conversation model", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "chat",
          agent_id: null,
          model: null,
          created_at: 1,
          updated_at: 1,
        },
      ],
      catalogModels: [{ id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'OpenAI', capabilities: [] }],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    const textarea = screen.getByRole("textbox", { name: /message input/i });
    await user.type(textarea, "/model gpt-4.1");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockApi.setConversationModel).toHaveBeenCalledWith(
      "conv-1",
      "gpt-4.1",
    );
  });
});

// ── Chat Context Bar & Accurate Model Indicator ───────────────────

describe("ChatWindow — Context Bar (O.1)", () => {
  it("o1-1: context bar is hidden when no project and no agent", () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    expect(
      screen.queryByRole("region", { name: /chat context/i }),
    ).not.toBeInTheDocument();
  });

  it("o1-2: context bar shows project name when conversation has a project", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Test",
          project_id: "proj-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() =>
      expect(screen.getByText("My Project")).toBeInTheDocument(),
    );
  });

  it("o1-3: context bar shows conversation agent name", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "T",
          project_id: "proj-1",
          agent_id: "a1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [{ id: "a1", name: "Coder", icon: "🧑‍💻", model: "gpt-4.1" }],
      activeAgentId: "stale-agent",
      projects: [
        {
          id: "proj-1",
          name: "My Project",
          color: "green",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => expect(screen.getByText("Coder")).toBeInTheDocument());
  });

  it("o1-4: context bar does not fall back to a project primary agent", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "T",
          project_id: "proj-2",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [{ id: "a2", name: "Reviewer", icon: "🔍", model: "default" }],
      activeAgentId: null,
      projects: [
        {
          id: "proj-2",
          name: "Alpha",
          color: "purple",
          created_at: 0,
          updated_at: 0,
        },
      ],
      projectAgents: {
        "proj-2": [
          {
            agentId: "a2",
            agentName: "Reviewer",
            agentIcon: "🔍",
            isPrimary: true,
            sortOrder: 0,
          },
        ],
      },
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => {
      expect(screen.getByLabelText("Agent context")).toHaveTextContent("No agent");
      expect(screen.queryByText("Reviewer")).not.toBeInTheDocument();
    });
  });
});

describe("ChatWindow — Model Dropdown (O.2)", () => {
  it("o2-1: model dropdown reflects conversation-level model override", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "T",
          project_id: null,
          model: "claude-sonnet-4.6",
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /conversation model/i });
      expect(btn).toHaveTextContent("Claude Sonnet 4.6");
    });
  });

  it("o2-2: model dropdown ignores stale active agent state for existing chats", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "T",
          project_id: null,
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [{ id: "a1", name: "Bot", icon: "🤖", model: "gpt-4.1" }],
      activeAgentId: "a1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /conversation model/i });
      expect(btn).toHaveTextContent("Global default");
    });
  });

  it("o2-3: model dropdown falls back to project default model", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "T",
          project_id: "proj-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "P",
          color: "blue",
          default_model: "gpt-4.1",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /conversation model/i });
      expect(btn).toHaveTextContent("GPT-4.1");
      expect(btn).toHaveTextContent("Project default");
    });
  });

  it("falls back to the global default when the project model is no longer available", async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      globalDefaultModel: "gpt-5-mini",
      availableModelsLoaded: true,
      availableModelGroups: [{
        sourceKey: "openai",
        sourceLabel: "OpenAI",
        sourceType: "provider",
        models: [{ id: "gpt-5-mini", label: "GPT-5 mini" }],
      }],
      currentConversationId: "conv-1",
      conversations: [{
        id: "conv-1",
        title: "T",
        project_id: "proj-1",
        model: null,
        pinned: false,
        created_at: 0,
        updated_at: 0,
      }],
      projects: [{
        id: "proj-1",
        name: "P",
        color: "blue",
        default_model: "removed-cli-model",
        created_at: 0,
        updated_at: 0,
      }],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /conversation model/i });
      expect(btn).toHaveTextContent("GPT-5 mini");
      expect(btn).not.toHaveTextContent("Project default");
    });
  });

  it("sets a CLI model as a conversation override without changing the project agent backend", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: {
        authenticated: true,
        mode: 'byok',
        user: null,
        cliInstalled: true,
        clis: { claude: false, codex: true },
      },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Project chat",
          project_id: "proj-1",
          agent_id: "agent-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Project Agent",
          icon: "A",
          systemPrompt: "",
          backend: undefined,
        },
      ],
      availableModelGroups: [
        {
          sourceKey: "openai",
          sourceLabel: "OpenAI",
          sourceType: "provider",
          models: [{ id: "gpt-5-mini", label: "GPT-5 mini" }],
        },
        {
          sourceKey: "codex-cli",
          sourceLabel: "Codex CLI",
          sourceType: "cli",
          models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: /conversation model/i }));
    await user.click(await screen.findByText("GPT-5.5"));

    expect(mockApi.setConversationModel).toHaveBeenCalledWith("conv-1", "gpt-5.5", "codex-cli", null);
    expect(mockApi.updateAgent).not.toHaveBeenCalled();
  });

  it("locks the model picker to Codex CLI when the agent backend is forced", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: {
        authenticated: true,
        mode: 'byok',
        user: null,
        cliInstalled: true,
        clis: { claude: false, codex: true },
      },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Project chat",
          project_id: "proj-1",
          agent_id: "agent-1",
          model: "gpt-5.5",
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Project Agent",
          icon: "A",
          systemPrompt: "",
          backend: "codex-cli",
          cliModel: "gpt-5.5",
        },
      ],
      availableModelGroups: [
        {
          sourceKey: "openai",
          sourceLabel: "OpenAI",
          sourceType: "provider",
          models: [{ id: "gpt-5-mini", label: "GPT-5 mini" }],
        },
        {
          sourceKey: "codex-cli",
          sourceLabel: "Codex CLI",
          sourceType: "cli",
          models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    await user.click(screen.getByRole("button", { name: /gpt-5\.5.*codex cli/i }));
    expect((await screen.findAllByText("Codex CLI")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("GPT-5.5").length).toBeGreaterThan(0);
    expect(screen.queryByText("GPT-5 mini")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Chat backend locked by agent settings to Codex CLI")).toHaveTextContent("Agent locked");

    expect(mockApi.updateAgent).not.toHaveBeenCalled();
  });

  it("locks a Hermes agent to Hermes models and uses its configured model", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: {
        authenticated: true,
        mode: 'byok',
        user: null,
        cliInstalled: true,
        clis: { claude: true, codex: true },
      },
      globalDefaultModel: "claude-haiku-4-5-20251001",
      currentConversationId: "conv-1",
      conversations: [{
        id: "conv-1",
        title: "Hermes chat",
        project_id: null,
        agent_id: "agent-1",
        model: null,
        pinned: false,
        created_at: 0,
        updated_at: 0,
      }],
      agents: [{
        id: "agent-1",
        name: "Hermes Agent",
        icon: "⚙️",
        systemPrompt: "",
        backend: "hermes-cli",
        hermesProfile: "localllm-iso",
        cliModel: "anthropic/claude-sonnet-4-6",
      }],
      availableModelGroups: [
        {
          sourceKey: "anthropic",
          sourceLabel: "Anthropic",
          sourceType: "provider",
          models: [{ id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" }],
        },
        {
          sourceKey: "hermes-cli",
          sourceLabel: "Hermes Agent",
          sourceType: "cli",
          models: [{ id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Anthropic)" }],
        },
      ],
    });
    mockApi.listAvailableModels.mockResolvedValueOnce([{
      sourceKey: "hermes-cli",
      sourceLabel: "Hermes Agent",
      sourceType: "cli",
      models: [{ id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Anthropic)" }],
    }]);
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    const modelButton = await screen.findByRole("button", { name: /conversation model/i });
    expect(modelButton).toHaveTextContent("Claude Sonnet 4.6");
    expect(modelButton).toHaveTextContent("Hermes Agent");

    await user.click(modelButton);
    expect((await screen.findAllByText("Claude Sonnet 4.6 (Anthropic)")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Claude Haiku 4.5")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Chat backend locked by agent settings to Hermes Agent")).toHaveTextContent("Agent locked");
  });

  it("shows the forced CLI badge even if the conversation has a provider model", () => {
    mockStore = createMockAppStore({
      authState: {
        authenticated: true,
        mode: 'byok',
        user: null,
        cliInstalled: true,
        clis: { claude: false, codex: true },
      },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Project chat",
          project_id: "proj-1",
          agent_id: "agent-1",
          model: "claude-haiku-4.5",
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Project Agent",
          icon: "A",
          systemPrompt: "",
          backend: "codex-cli",
          cliModel: "gpt-5.5",
        },
      ],
      availableModelGroups: [
        {
          sourceKey: "openrouter",
          sourceLabel: "OpenRouter",
          sourceType: "provider",
          models: [{ id: "claude-haiku-4.5", label: "Claude Haiku 4.5" }],
        },
        {
          sourceKey: "codex-cli",
          sourceLabel: "Codex CLI",
          sourceType: "cli",
          models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    expect(screen.getByTitle("Active backend for this conversation")).toHaveTextContent("Codex CLI");
  });
});

describe("ChatWindow — Full Auto-Approve", () => {
  it("shows the auto-approve banner and disables it from the chat header", async () => {
    const user = userEvent.setup();
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Trusted chat",
          project_id: null,
          agent_id: "agent-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Trusted Agent",
          icon: "T",
          systemPrompt: "",
          fullAutoApprove: true,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    expect(screen.getByLabelText("Auto-approve warning")).toHaveTextContent("Auto-approve is ON");
    await user.click(screen.getByRole("button", { name: /disable/i }));

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ fullAutoApprove: false }),
    );
  });

});

// ── Resizable Input Panel ─────────────────────────────────────────────────────

describe("ChatWindow — Resizable Input Panel (P.1)", () => {
  it("p1-1: resize handle is present in the DOM", () => {
    render(<ChatWindow />);
    expect(screen.getByTestId("resize-handle")).toBeInTheDocument();
  });

  it("p1-2: dragging the handle upward increases textarea height", () => {
    render(<ChatWindow />);
    const handle = screen.getByTestId("resize-handle");
    const textarea = screen.getByRole("textbox", { name: /message input/i });

    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 0, bubbles: true, cancelable: true }));
    });
    act(() => {
      // The panel's bottom edge anchors at 0 in the test DOM, so moving the
      // cursor above it (negative clientY) grows the textarea upward.
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: -100, bubbles: true }));
    });

    const heightStr = (textarea as HTMLTextAreaElement).style.height;
    expect(parseInt(heightStr)).toBeGreaterThan(40);
  });

  it("p1-3: height is clamped to the minimum (40px)", () => {
    render(<ChatWindow />);
    const handle = screen.getByTestId("resize-handle");
    const textarea = screen.getByRole("textbox", { name: /message input/i });

    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 300, bubbles: true, cancelable: true }));
    });
    act(() => {
      // Dragging far downward would set a negative delta → clamped to 40
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: 600, bubbles: true }));
    });

    expect((textarea as HTMLTextAreaElement).style.height).toBe("40px");
  });

  it("p1-4: height is clamped to the maximum (400px)", () => {
    render(<ChatWindow />);
    const handle = screen.getByTestId("resize-handle");
    const textarea = screen.getByRole("textbox", { name: /message input/i });

    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 500, bubbles: true, cancelable: true }));
    });
    act(() => {
      // Dragging 1000px upward would exceed max → clamped to 400
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: -500, bubbles: true }));
    });

    expect((textarea as HTMLTextAreaElement).style.height).toBe("400px");
  });

  it("p1-5: pointerup stops further resize updates", () => {
    render(<ChatWindow />);
    const handle = screen.getByTestId("resize-handle");
    const textarea = screen.getByRole("textbox", { name: /message input/i });

    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 500, bubbles: true, cancelable: true }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: 450, bubbles: true }));
    });
    const heightAfterMove = (textarea as HTMLTextAreaElement).style.height;

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    act(() => {
      // Further moves after pointerup should not change height
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, bubbles: true }));
    });

    expect((textarea as HTMLTextAreaElement).style.height).toBe(heightAfterMove);
  });
});

// ── Scrollbar Cursor Fix ──────────────────────────────────────────────────────

describe("ChatWindow — Scrollbar Cursor Fix (P.2)", () => {
  it("p2-1: message input has chat-input class for scrollbar cursor fix", () => {
    render(<ChatWindow />);
    const textarea = screen.getByRole("textbox", { name: /message input/i });
    expect(textarea).toHaveClass("chat-input");
  });

  it("p2-2: message input has overflow-y-auto so the scrollbar is enabled", () => {
    render(<ChatWindow />);
    const textarea = screen.getByRole("textbox", { name: /message input/i });
    expect(textarea).toHaveClass("overflow-y-auto");
  });
});

// ── Directory Context Indicator ───────────────────────────────────────────────

describe("ChatWindow — Directory Context Indicator (R.2)", () => {
  it("r2-r-1: shows 📁 badge in context bar when project has rootDirectory set", async () => {
    mockApi.getProjectConfig.mockResolvedValue({ rootDirectory: "/home/user/myproject" });

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Test",
          project_id: "proj-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByLabelText(/File structure context active/i)).toBeInTheDocument();
    });
  });

  it("r2-r-2: does NOT show 📁 badge when project has no rootDirectory", async () => {
    mockApi.getProjectConfig.mockResolvedValue({ rootDirectory: "" });

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "Test",
          project_id: "proj-1",
          model: null,
          pinned: false,
          created_at: 0,
          updated_at: 0,
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<ChatWindow />);

    // Give the useEffect time to resolve
    await waitFor(() => {
      expect(screen.getByText("My Project")).toBeInTheDocument();
    });

    expect(screen.queryByLabelText(/File structure context active/i)).not.toBeInTheDocument();
  });

  it("r2-r-3: does NOT show 📁 badge when there is no project", () => {
    mockApi.getProjectConfig.mockResolvedValue({});

    render(<ChatWindow />);

    expect(screen.queryByLabelText(/File structure context active/i)).not.toBeInTheDocument();
  });
});

describe("ChatWindow — Rating widget", () => {
  it("submits a rating when a star is clicked in the actions menu", async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Hello", timestamp: 1000 },
    ]);
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /more options/i }));
    await userEvent.click(screen.getByRole("button", { name: /rate conversation/i }));
    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));

    expect(mockStore.submitConversationRating).toHaveBeenCalledWith("conv-1", 4);
  });

  it("shows the current rating as a badge when the conversation has been rated", async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "Hello", timestamp: 1000 },
    ]);
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: "conv-1",
      conversationRatings: { "conv-1": 5 },
    });
    setupStoreMock(useAppStore, mockStore);

    render(<ChatWindow />);

    await waitFor(() => {
      expect(screen.getByText("5/5")).toBeInTheDocument();
    });
  });
});
