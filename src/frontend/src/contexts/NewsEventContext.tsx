import { createContext, useContext } from "react";
import type { NewsDispatcherState } from "../hooks/useNewsEventDispatcher";

// Default no-op state — must match the full NewsDispatcherState interface
const defaultState: NewsDispatcherState = {
  lastEvent: null,
  lastDispatchedAt: null,
  error: null,
  isSyncing: false,
  manualRefresh: () => {},
};

export const NewsEventContext =
  createContext<NewsDispatcherState>(defaultState);

/** Convenience hook — equivalent to useContext(NewsEventContext) */
export function useNewsEvent(): NewsDispatcherState {
  return useContext(NewsEventContext);
}
