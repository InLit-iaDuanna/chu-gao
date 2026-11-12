"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { PanelLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
} from "@/components/ui";
import { ConversationSidebar } from "./chat/ConversationSidebar";
import { TopBar } from "./TopBar";
import { deleteConversation, getMe, listConversations } from "./lib/api";
import { activeConversationHref } from "./lib/active-conversation";
import type { ConversationSummary, Me } from "./lib/types";

interface StudioNavigation {
  activeId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}

interface WorkspaceContextValue {
  refreshThreads: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  setStudioNavigation: Dispatch<SetStateAction<StudioNavigation | null>>;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
  closeMobile: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspaceNavigation() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace navigation requires WorkspaceShell");
  return context;
}

export function WorkspaceSidebarToggle() {
  const { sidebarOpen, setSidebarOpen, setMobileOpen } =
    useWorkspaceNavigation();
  return (
    <>
      <IconButton
        variant="ghost"
        aria-label="展开对话侧栏"
        title="展开对话侧栏"
        onClick={() => setMobileOpen(true)}
        className="h-9 w-9 shrink-0 md:hidden"
      >
        <PanelLeft size={18} />
      </IconButton>
      <IconButton
        variant="ghost"
        aria-label={sidebarOpen ? "收起对话侧栏" : "展开对话侧栏"}
        title={sidebarOpen ? "收起对话侧栏" : "展开对话侧栏"}
        onClick={() => setSidebarOpen((value) => !value)}
        className="hidden h-9 w-9 shrink-0 md:inline-flex"
      >
        <PanelLeft size={18} />
      </IconButton>
    </>
  );
}

function pageTitle(pathname: string) {
  if (pathname.startsWith("/app/nodes") || pathname.startsWith("/app/canvas"))
    return "节点画布";
  if (pathname === "/app/publish") return "发布灵感";
  if (pathname.startsWith("/app/inspiration")) return "灵感圈";
  if (pathname.startsWith("/app/history")) return "历史图片";
  if (pathname.startsWith("/app/g/")) return "生成详情";
  if (pathname.startsWith("/app/ppt")) return "PPT";
  if (pathname.startsWith("/app/recharge")) return "充值";
  if (pathname.startsWith("/app/settings")) return "设置";
  return "Chūgǎo Studio";
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isStudio = pathname === "/app" || pathname === "/app/";
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [studioNavigation, setStudioNavigation] =
    useState<StudioNavigation | null>(null);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const balanceVersion = useRef(0);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const refreshBalance = useCallback(async () => {
    const version = ++balanceVersion.current;
    const data = await getMe();
    if (mounted.current && version === balanceVersion.current) setMe(data);
  }, []);
  const refreshThreads = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const result = await listConversations(50);
      if (!mounted.current || version !== requestVersion.current) return;
      setThreads(result.items);
      setError(null);
    } catch {
      if (mounted.current && version === requestVersion.current)
        setError("对话列表暂时无法读取");
    } finally {
      if (mounted.current && version === requestVersion.current)
        setLoading(false);
    }
  }, []);

  const deleteThread = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      if (studioNavigation?.activeId === id) studioNavigation.onNew();
      await refreshThreads();
    },
    [refreshThreads, studioNavigation],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
      balanceVersion.current += 1;
    };
  }, []);

  useEffect(() => {
    closeMobile();
    void refreshThreads();
    if (isStudio) return;
    void refreshBalance().catch(() => undefined);
    return () => {
      balanceVersion.current += 1;
    };
  }, [pathname, isStudio, closeMobile, refreshThreads, refreshBalance]);

  const context = useMemo(
    () => ({
      refreshThreads,
      refreshBalance,
      setStudioNavigation,
      sidebarOpen,
      setSidebarOpen,
      setMobileOpen,
      closeMobile,
    }),
    [refreshThreads, refreshBalance, sidebarOpen, closeMobile],
  );

  const disabled = isStudio && (!studioNavigation || studioNavigation.disabled);
  const sidebar = (
    <ConversationSidebar
      pathname={pathname}
      threads={threads}
      activeId={isStudio ? (studioNavigation?.activeId ?? null) : null}
      disabled={disabled}
      loading={loading}
      error={error}
      onReload={() => void refreshThreads()}
      onNavigate={closeMobile}
      onSelect={(id) => {
        if (disabled) return;
        closeMobile();
        if (isStudio) studioNavigation?.onSelect(id);
        else router.push(activeConversationHref(id));
      }}
      onDelete={deleteThread}
      onNew={() => {
        if (disabled) return;
        closeMobile();
        if (isStudio) studioNavigation?.onNew();
        else router.push("/app");
      }}
    />
  );

  return (
    <WorkspaceContext.Provider value={context}>
      <div className="studio-workspace flex h-dvh min-h-0 overflow-hidden bg-background text-foreground md:h-screen">
        {sidebarOpen ? (
          <aside
            aria-label="对话侧栏"
            className="hidden h-full w-56 shrink-0 border-r border-border md:block lg:w-60 xl:w-64"
          >
            {sidebar}
          </aside>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!isStudio ? (
            <TopBar
              me={me}
              model={null}
              title={pageTitle(pathname)}
              leading={<WorkspaceSidebarToggle />}
            />
          ) : null}
          <div className="min-h-0 min-w-0 flex-1">{children}</div>
        </div>
      </div>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="studio-workspace left-0 top-0 h-dvh w-[min(280px,calc(100vw-40px))] max-w-none translate-x-0 translate-y-0 rounded-none p-0"
        >
          <DialogTitle className="sr-only">对话与导航</DialogTitle>
          {sidebar}
        </DialogContent>
      </Dialog>
    </WorkspaceContext.Provider>
  );
}
