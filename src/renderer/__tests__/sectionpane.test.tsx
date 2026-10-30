import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SectionPane } from "../components/SectionPane";
import { createMockAppStore, setupStoreMock } from "../../test/mocks/store";
import { setupMockApi } from "../../test/mocks/api";
import type { ProjectAgent } from "../store/types";

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }));

vi.mock("../store/app-store", () => ({ useAppStore }));

// ResizeHandle requires pointer events — stub it out
vi.mock("../components/ResizeHandle", () => ({
  ResizeHandle: () => null,
}));

// ProjectSettingsPanel — stub so we can assert it renders without full setup
vi.mock("../components/ProjectSettingsPanel", () => ({
  ProjectSettingsPanel: ({
    projectId,
    onClose,
  }: {
    projectId: string;
    onClose: () => void;
  }) => (
    <div data-testid="project-settings-panel" data-project-id={projectId}>
      <button onClick={onClose}>Close settings</button>
    </div>
  ),
}));

let mockStore: ReturnType<typeof createMockAppStore>;

beforeEach(() => {
  vi.clearAllMocks();
  setupMockApi();
  mockStore = createMockAppStore({
    activeSectionPane: "projects" as const,
    projects: [
      {
        id: "p1",
        name: "My Project",
        color: "blue",
        created_at: 0,
        default_model: null,
      },
    ],
    conversations: [],
    agents: [],
    agentsLoading: false,
    activeProjectId: null,
    activeAgentId: null,
    currentConversationId: null,
  });
  setupStoreMock(useAppStore, mockStore);
});

describe("SectionPane", () => {
  it("renders the projects header when section is projects", () => {
    render(<SectionPane section="projects" />);
    expect(
      screen.getByRole("heading", { name: /projects/i }),
    ).toBeInTheDocument();
  });

  it("renders the agents header when section is agents", () => {
    render(<SectionPane section="agents" />);
    expect(
      screen.getByRole("heading", { name: /agents/i }),
    ).toBeInTheDocument();
  });

  it("renders the chats header when section is chats", () => {
    render(<SectionPane section="chats" />);
    expect(
      screen.getByRole("heading", { name: /all chats/i }),
    ).toBeInTheDocument();
  });

  it("renders the Automated Workflows header when section is workflows", () => {
    render(<SectionPane section="workflows" />);
    expect(
      screen.getByRole("heading", { name: /automated workflows/i }),
    ).toBeInTheDocument();
  });

  it("calls setSectionPane with the current section when close button is clicked", async () => {
    render(<SectionPane section="projects" />);
    const closeBtn = screen.getByRole("button", {
      name: /close projects panel/i,
    });
    await userEvent.click(closeBtn);
    expect(mockStore.setSectionPane).toHaveBeenCalledWith("projects");
  });

  it("shows project list in projects pane", () => {
    render(<SectionPane section="projects" />);
    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  it('shows "No agents configured" message when agents list is empty', () => {
    render(<SectionPane section="agents" />);
    expect(screen.getByText(/no agents configured/i)).toBeInTheDocument();
  });

  it("keeps a stable hook order when agents finish loading", () => {
    mockStore.agentsLoading = true;
    const { rerender, container } = render(<SectionPane section="agents" />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();

    mockStore.agentsLoading = false;
    (mockStore as { agents: unknown[] }).agents = [
      {
        id: "agent-loaded",
        name: "Loaded Agent",
        icon: "🤖",
        systemPrompt: "",
        temperature: 0.7,
        maxTokens: 4096,
        contextDirectories: [],
        contextFiles: [],
        mcpServers: [],
        agenticMode: false,
        tools: {
          fileEdit: { enabled: false, approval: "always-ask", instructions: "" },
          terminal: { enabled: false, approval: "always-ask", instructions: "" },
          webFetch: { enabled: false, approval: "always-ask", instructions: "" },
        },
        responseFormat: "default",
      },
    ];

    expect(() => rerender(<SectionPane section="agents" />)).not.toThrow();
    expect(screen.getByText("Loaded Agent")).toBeInTheDocument();
  });

  it('shows "No conversations yet" message when conversations list is empty', () => {
    render(<SectionPane section="chats" />);
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
  });

  it("renders the pinned chats header and only pinned conversations", () => {
    const pinnedConversation = {
      id: "pinned-chat",
      agent_id: null,
      title: "Pinned conversation",
      project_id: null as string | null,
      pinned: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    const unpinnedConversation = {
      ...pinnedConversation,
      id: "regular-chat",
      title: "Regular conversation",
      pinned: 0,
    };
    mockStore = createMockAppStore({
      activeSectionPane: "pinned" as const,
      conversations: [pinnedConversation, unpinnedConversation],
    });
    setupStoreMock(useAppStore, mockStore);

    render(<SectionPane section="pinned" />);

    expect(screen.getByRole("heading", { name: /pinned chats/i })).toBeInTheDocument();
    expect(screen.getByText("Pinned conversation")).toBeInTheDocument();
    expect(screen.queryByText("Regular conversation")).not.toBeInTheDocument();
  });

  it('marks the open conversation in all-chats history', () => {
    const conversation = {
      id: "open-chat",
      agent_id: null,
      title: "Open chat",
      project_id: null as string | null,
      pinned: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    mockStore = createMockAppStore({
      activeSectionPane: "chats" as const,
      conversations: [conversation],
      currentConversationId: conversation.id,
    });
    setupStoreMock(useAppStore, mockStore);

    render(<SectionPane section="chats" />);

    const activeChat = screen.getByText("Open chat").closest("[aria-current='page']");
    expect(activeChat).toBeInTheDocument();
    expect(activeChat).toHaveClass("border-nexy-accent", "bg-nexy-accent/10");
    expect(activeChat).not.toHaveClass("border-transparent");
  });
});

// ── Pin/unpin toggle in Chats pane ─────────────────────────────────

describe("SectionPane — Chats pane pin/unpin toggle", () => {
  const now = Date.now();
  const pinnedConv = {
    id: "c-pinned",
    agent_id: null,
    title: "Pinned chat",
    project_id: null as string | null,
    pinned: 1,
    created_at: now,
    updated_at: now,
  };
  const unpinnedConv = {
    id: "c-unpinned",
    agent_id: null,
    title: "Unpinned chat",
    project_id: null as string | null,
    pinned: 0,
    created_at: now,
    updated_at: now,
  };

  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockApi();
    mockStore = createMockAppStore({
      activeSectionPane: "chats" as const,
      projects: [],
      agents: [],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      currentConversationId: null,
      conversations: [pinnedConv, unpinnedConv],
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("shows an 'Unpin conversation' button for an already-pinned chat", () => {
    render(<SectionPane section="chats" />);
    expect(
      screen.getByRole("button", { name: /unpin conversation/i }),
    ).toBeInTheDocument();
  });

  it("shows a 'Pin conversation' button for a chat that isn't pinned", () => {
    render(<SectionPane section="chats" />);
    expect(
      screen.getByRole("button", { name: "Pin conversation" }),
    ).toBeInTheDocument();
  });

  it("clicking the button on a pinned chat calls setConversationPinned with false", async () => {
    render(<SectionPane section="chats" />);
    await userEvent.click(
      screen.getByRole("button", { name: /unpin conversation/i }),
    );
    expect(mockStore.setConversationPinned).toHaveBeenCalledWith(
      "c-pinned",
      false,
    );
  });

  it("clicking the button on an unpinned chat calls setConversationPinned with true", async () => {
    render(<SectionPane section="chats" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Pin conversation" }),
    );
    expect(mockStore.setConversationPinned).toHaveBeenCalledWith(
      "c-unpinned",
      true,
    );
  });
});

// ── Agent membership UI ──────────────────────────────────────────

describe("SectionPane — Agent membership (G4)", () => {
  const MEMBER: ProjectAgent = {
    agentId: "agent-1",
    agentName: "Tester Bot",
    agentIcon: "🤖",
    isPrimary: true,
    sortOrder: 0,
  };

  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    setupMockApi();
    vi.clearAllMocks();
    mockStore = createMockAppStore({
      activeSectionPane: "projects" as const,
      projects: [
        {
          id: "p1",
          name: "My Project",
          color: "blue",
          created_at: 0,
          default_model: null,
        },
      ],
      projectAgents: { p1: [MEMBER] },
      conversations: [],
      agents: [
        {
          id: "agent-2",
          config_json: JSON.stringify({
            name: "Helper",
            icon: "🛠️",
            model: "gpt-4o",
            systemPrompt: "",
            temperature: 0.7,
            maxTokens: 4096,
            contextDirectories: [],
            contextFiles: [],
            mcpServers: [],
            agenticMode: false,
            tools: {},
            responseFormat: "default",
          }),
          is_default: 0,
          created_at: 0,
          updated_at: 0,
        },
      ],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      currentConversationId: null,
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("g4-1: agent avatar stack renders in the compact project row", () => {
    render(<SectionPane section="projects" />);
    // The avatar stack shows the agent's icon in a small circle
    expect(screen.getByTitle("Tester Bot")).toBeInTheDocument();
  });

  it("g4-2: compact project row shows Settings and Delete buttons on hover", () => {
    render(<SectionPane section="projects" />);
    expect(
      screen.getByRole("button", { name: /edit project settings/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete project/i }),
    ).toBeInTheDocument();
  });

  it("g4-3: clicking Settings button on compact row calls openEditProject", async () => {
    render(<SectionPane section="projects" />);
    await userEvent.click(
      screen.getByRole("button", { name: /edit project settings/i }),
    );
    expect(mockStore.openEditProject).toHaveBeenCalledWith("p1");
  });

  it("g4-4: agent cards in AgentsPane have data-agent-id attribute", () => {
    render(<SectionPane section="agents" />);
    const card = document.querySelector('[data-agent-id="agent-2"]');
    expect(card).not.toBeNull();
  });

  it("g4-5: agent cards in AgentsPane are draggable", () => {
    render(<SectionPane section="agents" />);
    const card = document.querySelector('[data-agent-id="agent-2"]');
    expect(card).toHaveAttribute("draggable", "true");
  });

  it("g4-6: dragStart on agent card sets agent-id in dataTransfer", () => {
    render(<SectionPane section="agents" />);
    const card = document.querySelector(
      '[data-agent-id="agent-2"]',
    ) as HTMLElement;
    expect(card).not.toBeNull();
    const dt = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith("agent-id", "agent-2");
  });
});

// ── Agent Deletion UI ─────────────────────────────────────────────

describe("SectionPane — Agent deletion (I6)", () => {
  const NON_DEFAULT_AGENT = {
    id: "agent-del",
    name: "Deletable Agent",
    icon: "🗑",
    model: "gpt-4o",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: {
      fileEdit: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      terminal: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      webFetch: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
    },
    responseFormat: "default",
    isDefault: false,
  };

  const DEFAULT_AGENT = {
    id: "agent-default",
    name: "Default Agent",
    icon: "🤖",
    model: "gpt-4o",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: {
      fileEdit: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      terminal: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      webFetch: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
    },
    responseFormat: "default",
    isDefault: true,
  };

  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    setupMockApi();
    vi.clearAllMocks();
    mockStore = createMockAppStore({
      activeSectionPane: "agents" as const,
      projects: [],
      conversations: [],
      agents: [NON_DEFAULT_AGENT],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      currentConversationId: null,
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("i6-1: delete button is present on non-default agent card", () => {
    render(<SectionPane section="agents" />);
    const btn = screen.getByRole("button", { name: /delete deletable agent/i });
    expect(btn).toBeInTheDocument();
  });

  it("i6-2: clicking delete button calls deleteAgent store action", async () => {
    render(<SectionPane section="agents" />);
    const btn = screen.getByRole("button", { name: /delete deletable agent/i });
    await userEvent.click(btn);
    expect(mockStore.deleteAgent).toHaveBeenCalledWith("agent-del");
  });

  it("i6-3: delete button is present on default agent card", () => {
    mockStore = createMockAppStore({
      activeSectionPane: "agents" as const,
      projects: [],
      conversations: [],
      agents: [DEFAULT_AGENT],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      currentConversationId: null,
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="agents" />);
    const btn = screen.getByRole("button", { name: /delete default agent/i });
    expect(btn).toBeInTheDocument();
  });
});

// ── Project settings panel (J5/J6 UI wiring) ─────────────────────

describe("SectionPane — Project settings panel (J5)", () => {
  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    setupMockApi();
    vi.clearAllMocks();
    mockStore = createMockAppStore({
      activeSectionPane: "projects" as const,
      projects: [
        {
          id: "p1",
          name: "Alpha Project",
          color: "blue",
          created_at: 0,
          default_model: null,
        },
      ],
      projectConfigs: {
        p1: {
          instructions: "Be concise.",
          rootDirectory: "",
          instructionMode: "prepend",
          instructionsEnabled: true,
          variables: [],
          workflowMode: "single-agent",
          orchestrationEnabled: false,
          maxDelegationDepth: 3,
          showTeamActivity: false,
        },
      },
      conversations: [],
      agents: [],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      currentConversationId: null,
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("j5-1: project settings panel is not rendered inline in SectionPane", () => {
    render(<SectionPane section="projects" />);
    // Panel is now rendered in App.tsx — SectionPane only calls openEditProject
    expect(
      screen.queryByTestId("project-settings-panel"),
    ).not.toBeInTheDocument();
  });

  it("j5-2: clicking the settings gear calls openEditProject with the project id", async () => {
    render(<SectionPane section="projects" />);
    const settingsBtn = screen.getByRole("button", {
      name: /edit project settings/i,
    });
    await userEvent.click(settingsBtn);
    expect(mockStore.openEditProject).toHaveBeenCalledWith("p1");
  });

  it("j5-3: clicking the settings gear calls openEditProject with the correct id for each project", async () => {
    render(<SectionPane section="projects" />);
    const settingsBtn = screen.getByRole("button", {
      name: /edit project settings/i,
    });
    await userEvent.click(settingsBtn);
    expect(mockStore.openEditProject).toHaveBeenCalledTimes(1);
    expect(mockStore.openEditProject).toHaveBeenCalledWith("p1");
  });
});

// ── Intuitive agent-to-project assignment ─────────────────────────

describe("SectionPane — Agent-to-project assignment (L)", () => {
  const AGENT_A = {
    id: "a1",
    name: "Alpha Bot",
    icon: "🔵",
    model: "gpt-4o",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: {
      fileEdit: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      terminal: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      webFetch: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
    },
    responseFormat: "default",
    isDefault: false,
  };
  const AGENT_B = {
    id: "a2",
    name: "Beta Bot",
    icon: "🟢",
    model: "gpt-4o",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [] as string[],
    contextFiles: [] as string[],
    mcpServers: [] as string[],
    agenticMode: false,
    tools: {
      fileEdit: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      terminal: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
      webFetch: {
        enabled: false,
        approval: "always-ask" as const,
        instructions: "",
      },
    },
    responseFormat: "default",
    isDefault: false,
  };

  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    setupMockApi();
    vi.clearAllMocks();
    mockStore = createMockAppStore({
      activeSectionPane: "projects" as const,
      projects: [
        {
          id: "p1",
          name: "Project One",
          color: "blue",
          created_at: 0,
          default_model: null,
        },
      ],
      projectAgents: {},
      agents: [AGENT_A, AGENT_B],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      conversations: [],
      currentConversationId: null,
    });
    setupStoreMock(useAppStore, mockStore);
  });

  // "Add to project" popover on agent rows in AgentsPane
  it('l2-1: "Add to project" button appears on agent rows in AgentsPane', () => {
    mockStore = createMockAppStore({
      ...mockStore,
      activeSectionPane: "agents" as const,
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="agents" />);
    expect(
      screen.getByRole("button", { name: /add alpha bot to project/i }),
    ).toBeInTheDocument();
  });

  it('l2-2: clicking "Add to project" button opens project list popover', async () => {
    mockStore = createMockAppStore({
      ...mockStore,
      activeSectionPane: "agents" as const,
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="agents" />);
    await userEvent.click(
      screen.getByRole("button", { name: /add alpha bot to project/i }),
    );
    expect(screen.getByText("Project One")).toBeInTheDocument();
  });

  it("l2-3: selecting a project from popover calls addAgentToProject", async () => {
    mockStore = createMockAppStore({
      ...mockStore,
      activeSectionPane: "agents" as const,
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="agents" />);
    await userEvent.click(
      screen.getByRole("button", { name: /add alpha bot to project/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /add alpha bot to project one/i }),
    );
    expect(mockStore.addAgentToProject).toHaveBeenCalledWith("p1", "a1");
  });

  // Compact project row: drop zone for external agent drags still works
  it("m6-3: inline agent picker no longer rendered in the project card", () => {
    render(<SectionPane section="projects" />);
    expect(
      screen.queryByText(/add agent.*drag from sidebar/i),
    ).not.toBeInTheDocument();
  });

  it("drop-1: dropping an agent onto a compact project row calls addAgentToProject", async () => {
    render(<SectionPane section="projects" />);
    const row = document.querySelector('[data-project-id="p1"]') as HTMLElement;
    expect(row).not.toBeNull();
    fireEvent.drop(row, {
      dataTransfer: {
        getData: (t: string) => (t === "agent-id" ? "a1" : ""),
        types: ["agent-id"],
      },
    });
    await vi.waitFor(() => {
      expect(mockStore.addAgentToProject).toHaveBeenCalledWith("p1", "a1");
    });
  });
});

// ── "No Project" bucket + Project History pane ───────────────────────────────

describe("SectionPane — No Project bucket & Project History (Q1/Q2)", () => {
  const now = Date.now();
  const projectConv = {
    id: "pc1",
    agent_id: null,
    title: "Project chat",
    project_id: "p1",
    created_at: now,
    updated_at: now,
  };
  const orphanConv = {
    id: "oc1",
    agent_id: null,
    title: "Orphan chat",
    project_id: null as string | null | undefined,
    created_at: now,
    updated_at: now,
  };

  let mockStore: ReturnType<typeof createMockAppStore>;

  beforeEach(() => {
    setupMockApi();
    vi.clearAllMocks();
    mockStore = createMockAppStore({
      activeSectionPane: "projects" as const,
      projects: [
        { id: "p1", name: "My Project", color: "blue", created_at: 0, default_model: null },
      ],
      projectAgents: {},
      agents: [],
      agentsLoading: false,
      activeProjectId: null,
      activeAgentId: null,
      conversations: [projectConv, orphanConv],
      currentConversationId: null,
      historyProjectId: null,
    });
    setupStoreMock(useAppStore, mockStore);
  });

  it("q1-1: '(No project)' sentinel is NOT rendered in ProjectsPane (moved to sidebar)", () => {
    render(<SectionPane section="projects" />);
    expect(screen.queryByLabelText(/no project.*unaffiliated/i)).not.toBeInTheDocument();
  });

  it("q2-1: when historyProjectId is set, ProjectHistoryPane renders instead of ProjectsPane", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "p1",
      activeProjectId: "p1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    // ProjectsPane header shows project name, not "Projects"
    expect(screen.getByRole("heading", { name: /my project/i })).toBeInTheDocument();
    // ProjectsPane project card should NOT be visible
    expect(screen.queryByRole("button", { name: /add agent to project/i })).not.toBeInTheDocument();
  });

  it("q2-2: back button calls setHistoryProjectId(null)", async () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "p1",
      activeProjectId: "p1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    const backBtn = screen.getByRole("button", { name: /back to projects/i });
    await userEvent.click(backBtn);
    expect(mockStore.setHistoryProjectId).toHaveBeenCalledWith(null);
  });

  it("q2-3: ProjectHistoryPane shows only conversations matching the historyProjectId", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "p1",
      activeProjectId: "p1",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    expect(screen.getByText("Project chat")).toBeInTheDocument();
    expect(screen.queryByText("Orphan chat")).not.toBeInTheDocument();
  });

  it("q2-3a: ProjectHistoryPane marks the open conversation", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "p1",
      activeProjectId: "p1",
      currentConversationId: projectConv.id,
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);

    const activeChat = screen.getByText("Project chat").closest("[aria-current='page']");
    expect(activeChat).toBeInTheDocument();
    expect(activeChat).toHaveClass("border-nexy-accent", "bg-nexy-accent/10", "shadow-nexy");
    expect(activeChat).not.toHaveClass("border-transparent");
  });

  it("q2-4: ProjectHistoryPane with '__none__' shows only orphan conversations", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "__none__",
      activeProjectId: "__none__",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    expect(screen.getByText("Orphan chat")).toBeInTheDocument();
    expect(screen.queryByText("Project chat")).not.toBeInTheDocument();
  });

  it("q2-5: header shows 'No project' breadcrumb when historyProjectId is '__none__'", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "__none__",
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    expect(screen.getByRole("heading", { name: /no project/i })).toBeInTheDocument();
  });

  it("q2-6: ProjectHistoryPane shows a spinner for a generating conversation", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "p1",
      activeProjectId: "p1",
      generatingConversationIds: ["pc1"],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);
    const indicator = screen.getByTitle("Generating…");
    expect(indicator).toBeInTheDocument();
    expect(indicator.querySelector("svg")).toHaveClass("lucide-loader-circle", "animate-spin");
  });

  it("q2-7: completed conversation action is a left-side hover control", () => {
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "p1",
      activeProjectId: "p1",
      completedConversationIds: ["pc1"],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);

    const markIncomplete = screen.getByRole("button", { name: /mark conversation incomplete/i });
    expect(markIncomplete).toHaveClass("absolute", "left-3", "opacity-0", "group-hover:opacity-100");
    expect(markIncomplete.querySelector("svg")).toBeInTheDocument();
  });

  it("q2-8: completed_at controls the left hover action even when absent from completedConversationIds", async () => {
    // Regression: scoped (project) conversations arrive via pagination and are not seeded into
    // completedConversationIds (which is derived only from the global conversation load), so the
    // completion checkmark must fall back to the conversation's own completed_at.
    mockStore = createMockAppStore({
      ...mockStore,
      historyProjectId: "p1",
      activeProjectId: "p1",
      conversations: [{ ...projectConv, completed_at: now }, orphanConv],
      completedConversationIds: [],
    });
    setupStoreMock(useAppStore, mockStore);
    render(<SectionPane section="projects" />);

    await userEvent.click(screen.getByRole("tab", { name: "Completed" }));
    expect(screen.getByRole("button", { name: /mark conversation incomplete/i })).toBeInTheDocument();
  });
});
