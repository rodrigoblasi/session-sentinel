import type { ParsedEvent, RunStartType } from '../shared/types.js';
import { RUN_START_HOOKS } from '../shared/constants.js';

export interface RunBoundary {
  startType: RunStartType;
  entrypoint: string | null;
  previousEntrypoint: string | null;
  isHandoff: boolean;
  timestamp: string | null;
  remoteUrl: string | null;
}

export class RunDetector {
  private eventsSeen = 0;
  private lastEntrypoint: string | null = null;
  private sawLastPrompt = false;
  private hasBridgeStatus = false;

  /**
   * Check if a parsed event marks a run boundary.
   * Call markEventSeen() after processing each event.
   */
  checkBoundary(event: ParsedEvent): RunBoundary | null {
    // Signal 1: SessionStart hook (primary, most reliable)
    if (event.type === 'progress:hook' && event.hookName) {
      const hookKey = event.hookName;
      const startType = RUN_START_HOOKS[hookKey] as RunStartType | undefined;

      if (startType) {
        const isNewRun = this.eventsSeen > 0;
        const previousEntrypoint = this.lastEntrypoint;
        const entrypoint = event.entrypoint;

        if (entrypoint) this.lastEntrypoint = entrypoint;
        this.sawLastPrompt = false;
        // Reset bridge_status sentinel so the next bridge_status (same run) doesn't fire Signal 2
        this.hasBridgeStatus = false;

        // Only report boundary if this is the first event or we've seen events before
        if (isNewRun || startType === 'startup') {
          return {
            startType: isNewRun ? startType : 'startup',
            entrypoint,
            previousEntrypoint: isNewRun ? previousEntrypoint : null,
            isHandoff: isNewRun && !!previousEntrypoint && !!entrypoint && previousEntrypoint !== entrypoint,
            timestamp: event.timestamp,
            remoteUrl: null,
          };
        }
      }
    }

    // Signal 2: bridge_status after existing bridge_status (new Remote URL = new run)
    if (event.type === 'system:bridge_status') {
      if (this.hasBridgeStatus && this.eventsSeen > 0) {
        const previousEntrypoint = this.lastEntrypoint;
        this.hasBridgeStatus = true;
        return {
          startType: 'resume',
          entrypoint: event.entrypoint,
          previousEntrypoint,
          isHandoff: false,
          timestamp: event.timestamp,
          remoteUrl: event.remoteUrl,
        };
      }
      this.hasBridgeStatus = true;
    }

    // Signal 3: last-prompt → next event = new run
    if (event.type === 'last_prompt') {
      this.sawLastPrompt = true;
      return null;
    }

    if (this.sawLastPrompt && event.type !== 'last_prompt') {
      this.sawLastPrompt = false;
      const previousEntrypoint = this.lastEntrypoint;
      if (event.entrypoint) this.lastEntrypoint = event.entrypoint;

      return {
        startType: 'resume',
        entrypoint: event.entrypoint,
        previousEntrypoint,
        isHandoff: !!previousEntrypoint && !!event.entrypoint && previousEntrypoint !== event.entrypoint,
        timestamp: event.timestamp,
        remoteUrl: null,
      };
    }

    // Track entrypoint from any event
    if (event.entrypoint && this.lastEntrypoint === null) {
      this.lastEntrypoint = event.entrypoint;
    }

    return null;
  }

  markEventSeen(): void {
    this.eventsSeen++;
  }
}
