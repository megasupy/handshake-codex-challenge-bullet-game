export type MenuTab = "home" | "runs" | "history" | "progress" | "settings" | "telemetry";

const VALID_MENU_TABS: MenuTab[] = ["home", "runs", "history", "progress", "settings", "telemetry"];

export function normalizeMenuTab(tab: string): MenuTab {
  return VALID_MENU_TABS.includes(tab as MenuTab) ? (tab as MenuTab) : "home";
}

export function renderMenuTabs(panels: HTMLElement[], buttons: HTMLButtonElement[], activeTab: MenuTab): void {
  for (const panel of panels) {
    panel.classList.toggle("hidden", panel.dataset.menuTab !== activeTab);
  }
  for (const button of buttons) {
    const active = button.dataset.menuTabButton === activeTab;
    button.className = active ? "btn-primary px-3 py-2" : "btn-secondary px-3 py-2";
  }
}
