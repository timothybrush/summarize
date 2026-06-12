import { describe, expect, it } from "vitest";
import {
  createInitialPanelState,
  createPanelStateStore,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/panel-state-store";
import {
  retainRenderedSlideSummary,
  selectRetainedSlideSummaryMarkdown,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/retained-slide-summary";

describe("retained slide summary", () => {
  it("retains non-empty rendered markdown for the current source only", () => {
    const store = createPanelStateStore(createInitialPanelState());
    store.state.currentSource = {
      url: "https://example.com/watch?v=1#chapter",
      title: "Example",
    };

    expect(selectRetainedSlideSummaryMarkdown(store.state)).toBeNull();
    retainRenderedSlideSummary(store.state, store.dispatch, "  ");
    expect(store.state.retainedSlideSummary).toBeNull();

    retainRenderedSlideSummary(store.state, store.dispatch, "# Summary");
    expect(selectRetainedSlideSummaryMarkdown(store.state)).toBe("# Summary");

    store.state.currentSource = { url: "https://example.com/other", title: "Other" };
    expect(selectRetainedSlideSummaryMarkdown(store.state)).toBeNull();
  });

  it("uses the active tab as the retained-summary scope fallback", () => {
    const store = createPanelStateStore(createInitialPanelState());
    store.state.navigation.activeTabUrl = "https://example.com/watch?v=1";

    retainRenderedSlideSummary(store.state, store.dispatch, "Summary");

    expect(store.state.retainedSlideSummary).toEqual({
      markdown: "Summary",
      url: "https://example.com/watch?v=1",
    });
    store.state.navigation.activeTabUrl = null;
    expect(selectRetainedSlideSummaryMarkdown(store.state)).toBe("Summary");
  });
});
