/**
 * Copyright 2015 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import objectAssign from "object-assign";
import {
  defer as observableDefer,
  Observable
} from "rxjs";
import {
  map,
  share,
} from "rxjs/operators";
import { isPlaybackStuck } from "../../compat";
import config from "../../config";
import log from "../../log";
import { getNextRangeGap } from "../../utils/ranges";
import calculateResilientBufferGap from "./calculate_resilient_buffer_gap";
import {
  IClockTick,
  IInitClockTick,
  IStallingItem,
} from "./types";

const { RESUME_GAP_AFTER_SEEKING,
        RESUME_GAP_AFTER_NOT_ENOUGH_DATA,
        RESUME_GAP_AFTER_BUFFERING,
        SKIPPABLE_DISCONTINUITY,
        STALL_GAP } = config;

/**
 * Returns the amount of time in seconds the buffer should have ahead of the
 * current position before resuming playback. Based on the infos of the stall.
 * Waiting time differs between a "seeking" stall and a buffering stall.
 * @param {Object|null} stalled
 * @param {Boolean} lowLatencyMode
 * @returns {Number}
 */
function getResumeGap(
  stalled : IStallingItem | null,
  lowLatencyMode : boolean
) : number {
  if (!stalled) {
    return 0;
  }
  const suffix : "LOW_LATENCY" | "DEFAULT" = lowLatencyMode ? "LOW_LATENCY" :
                                                              "DEFAULT";

  switch (stalled.reason) {
    case "seeking":
      return RESUME_GAP_AFTER_SEEKING[suffix];
    case "not-ready":
      return RESUME_GAP_AFTER_NOT_ENOUGH_DATA[suffix];
    default:
      return RESUME_GAP_AFTER_BUFFERING[suffix];
  }
}

/**
 * @param {Object} currentRange
 * @param {Number} duration
 * @param {Boolean} lowLatencyMode
 * @returns {Boolean}
 */
function hasLoadedUntilTheEnd(
  currentRange : { start : number; end : number }|null,
  duration : number,
  lowLatencyMode : boolean
) : boolean {
  const suffix : "LOW_LATENCY" | "DEFAULT" = lowLatencyMode ? "LOW_LATENCY" :
                                                              "DEFAULT";
  return currentRange != null &&
         (duration - currentRange.end) <= STALL_GAP[suffix];
}

/**
 * Infer stalled status of the media based on:
 *   - the return of the function getMediaInfos
 *   - the previous timings object.
 *
 * @param {Object} prevTick - Previous tick with stalling information.
 * @param {Object} currentTimings - Current tick, without stalling information
 * yet.
 * @param {Object} options
 * @returns {Object|null}
 */
function getStalledStatus(
  prevTick : IInitClockTick,
  currentTimings : IClockTick,
  { withMediaSource, lowLatencyMode } : { withMediaSource : boolean;
                                          lowLatencyMode : boolean; }
) : IStallingItem | null {
  const { state: currentState,
          currentTime,
          buffered,
          bufferGap,
          currentRange,
          duration,
          paused,
          readyState,
          ended } = currentTimings;

  const { state: prevState,
          currentTime: prevTime } = prevTick;

  const fullyLoaded = hasLoadedUntilTheEnd(currentRange, duration, lowLatencyMode);

  const canStall = (readyState >= 1 &&
                    currentState !== "loadedmetadata" &&
                    prevTick.stalled === null &&
                    !(fullyLoaded || ended));

  let shouldStall;
  let shouldUnstall;

  if (withMediaSource) {
    const stallingBufferGap = lowLatencyMode ? STALL_GAP.LOW_LATENCY :
                                               STALL_GAP.DEFAULT;
    if (canStall &&
        (bufferGap <= stallingBufferGap ||
         bufferGap === Infinity || readyState === 1)
    ) {
      // If very small discontinuities are present in the stream, do not stall
      const resilientBufferGap = calculateResilientBufferGap(currentTime,
                                                             bufferGap,
                                                             buffered);
      if (resilientBufferGap === Infinity || resilientBufferGap <= stallingBufferGap) {
        log.debug("Init: broadcasting stall order", bufferGap, readyState);
        shouldStall = true;
      } else {
        log.debug("Init: very small discontinuity encountered, not stalling");
      }
    } else {
      if (prevTick.stalled != null && readyState > 1 && bufferGap < Infinity) {
        if (fullyLoaded || ended) {
          log.debug("Init: Finished content, un-stall", fullyLoaded, ended);
          shouldUnstall = true;
        } else {
          const resumeGapWanted = getResumeGap(prevTick.stalled, lowLatencyMode);
          if (bufferGap >= resumeGapWanted) {
            log.debug("Init: Resume gap wanted reached, un-stall",
              bufferGap,
              resumeGapWanted);
            shouldUnstall = true;
          } else {
            // Check that we're not needlessly still rebuffering because of a
            // very small discontinuity later in the stream
            const resilientBufferGap = calculateResilientBufferGap(currentTime,
                                                                   bufferGap,
                                                                   buffered);
            if (resilientBufferGap > resumeGapWanted) {
              log.debug("Init: Un-stall despite small discontinuities",
                        currentTime,
                        currentRange != null ? currentRange.end : null,
                        resilientBufferGap);
              shouldUnstall = true;
            }
          }
        }
      }
    }
  }

  // when using a direct file, the media will stall and unstall on its
  // own, so we only try to detect when the media timestamp has not changed
  // between two consecutive timeupdates
  else {
    if (canStall &&
        (!paused && currentState === "timeupdate" &&
         prevState === "timeupdate" && currentTime === prevTime ||
         currentState === "seeking" && bufferGap === Infinity)
    ) {
      shouldStall = true;
    } else if (prevTick.stalled != null &&
               (currentState !== "seeking" && currentTime !== prevTime ||
                currentState === "canplay" ||
                bufferGap < Infinity &&
                (bufferGap > getResumeGap(prevTick.stalled, lowLatencyMode) ||
                 fullyLoaded || ended))
    ) {
      shouldUnstall = true;
    }
  }

  if (shouldUnstall) {
    return null;
  } else if (shouldStall || prevTick.stalled !== null) {
    let reason : "seeking" | "not-ready" | "buffering";
    if (currentState === "seeking" || currentTimings.seeking) {
      reason = "seeking";
    } else if (readyState === 1) {
      reason = "not-ready";
    } else {
      reason = "buffering";
    }
    if (prevTick.stalled !== null && reason === prevTick.stalled.reason) {
      return prevTick.stalled;
    } else {
      return { reason,
               timestamp: performance.now() };
    }
  }
  return null;
}

/**
 * Receive "stalling" events from the clock, try to get out of it, and re-emit
 * them for the player if the stalling status changed.
 * @param {HTMLMediaElement} mediaElement
 * @param {Observable} clock$
 * @returns {Observable}
 */
export default function createInitClock(
  mediaElement : HTMLMediaElement,
  clock$ : Observable<IClockTick>,
  options : { withMediaSource : boolean;
              lowLatencyMode : boolean; }
) : Observable<IInitClockTick> {
  return observableDefer(() => {
    let prevTick : IInitClockTick | null = null;
    return clock$.pipe(
      map(tick => {
        if (prevTick === null) {
          prevTick = objectAssign({ stalled: null }, tick);
          return prevTick;
        }
        const stalledStatus = getStalledStatus(prevTick, tick, options);
        prevTick = objectAssign({ stalled: stalledStatus }, tick);
        if (stalledStatus === null) {
          return objectAssign({ stalled: null }, tick);
        }

        // Perform various checks to try to get out of the stalled state:
        //   1. is it a browser bug? -> force seek at the same current time
        //   2. is it a short discontinuity? -> Seek at the beginning of the
        //                                      next range
        const { buffered, currentTime, currentRange, state } = tick;
        const nextRangeGap = getNextRangeGap(buffered, currentTime);

        // Discontinuity check in case we are close a buffered range but still
        // calculate a stalled state. This is useful for some
        // implementation that might drop an injected segment, or in
        // case of small discontinuity in the content.
        if (isPlaybackStuck(currentTime, currentRange, state, stalledStatus !== null)) {
          log.warn("Init: After freeze seek", currentTime, currentRange);
          mediaElement.currentTime = currentTime;
        } else if (nextRangeGap < SKIPPABLE_DISCONTINUITY) {
          const seekTo = (currentTime + nextRangeGap + 1 / 60);
          log.warn("Init: Discontinuity seek", currentTime, nextRangeGap, seekTo);
          mediaElement.currentTime = seekTo;
        }
        return prevTick;
      }),
      share()
    );
  });
}
