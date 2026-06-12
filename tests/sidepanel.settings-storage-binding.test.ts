import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindSettingsStorage } from "../apps/chrome-extension/src/entrypoints/sidepanel/bindings";
import {
  createInitialPanelState,
  createPanelStateStore,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/panel-state-store";

describe("sidepanel settings storage binding", () => {
  let onChanged: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;

  beforeEach(() => {
    vi.stubGlobal("chrome", {
      storage: {
        onChanged: {
          addListener: vi.fn((listener) => {
            onChanged = listener;
          }),
        },
      },
    });
  });

  it("merges pre-hydration settings while applying live controls", () => {
    const initialState = createInitialPanelState();
    initialState.panelSession.pendingSettingsSnapshot = { autoSummarize: true };
    const panelStateStore = createPanelStateStore(initialState);
    const applyChatEnabled = vi.fn();
    const hideAutomationNotice = vi.fn();

    bindSettingsStorage({
      panelState: panelStateStore.state,
      dispatchPanelState: panelStateStore.dispatch,
      applyChatEnabled,
      hideAutomationNotice,
    });

    onChanged(
      {
        settings: {
          newValue: {
            chatEnabled: false,
            automationEnabled: false,
          },
        },
      },
      "local",
    );

    expect(panelStateStore.state.panelSession).toMatchObject({
      chatEnabled: false,
      automationEnabled: false,
      pendingSettingsSnapshot: {
        autoSummarize: true,
        chatEnabled: false,
        automationEnabled: false,
      },
    });
    expect(applyChatEnabled).toHaveBeenCalledOnce();
    expect(hideAutomationNotice).toHaveBeenCalledOnce();
  });

  it("does not queue settings after hydration", () => {
    const initialState = createInitialPanelState();
    initialState.panelSession.settingsHydrated = true;
    const panelStateStore = createPanelStateStore(initialState);

    bindSettingsStorage({
      panelState: panelStateStore.state,
      dispatchPanelState: panelStateStore.dispatch,
      applyChatEnabled: vi.fn(),
      hideAutomationNotice: vi.fn(),
    });

    onChanged(
      {
        settings: {
          newValue: { chatEnabled: true },
        },
      },
      "local",
    );

    expect(panelStateStore.state.panelSession.pendingSettingsSnapshot).toBeNull();
    expect(panelStateStore.state.panelSession.chatEnabled).toBe(true);
  });
});
