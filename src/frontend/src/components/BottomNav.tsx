import { BarChart2, Newspaper, PieChart, User } from "lucide-react";
import type { ComponentType } from "react";

export type TabType = "markets" | "portfolio" | "feed" | "profile";

interface BottomNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const TABS: {
  id: TabType;
  label: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { id: "markets", label: "Markets", Icon: BarChart2 },
  { id: "portfolio", label: "Portfolio", Icon: PieChart },
  { id: "feed", label: "Feed", Icon: Newspaper },
  { id: "profile", label: "Profile", Icon: User },
];

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[9999] h-16 flex items-stretch border-t"
      style={{ backgroundColor: "#0a0a0a", borderTopColor: "#1f1f1f" }}
      aria-label="Main navigation"
      data-ocid="bottom_nav"
    >
      {TABS.map(({ id, label, Icon }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            data-ocid={`bottom_nav.tab_${id}`}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            <Icon
              className="w-5 h-5 shrink-0"
              strokeWidth={isActive ? 2.25 : 1.75}
            />
            <span
              className={`hidden sm:inline text-[10px] font-semibold uppercase tracking-wider leading-none ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
