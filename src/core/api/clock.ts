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

/**
 * This file defines a global clock for the RxPlayer.
 *
 * Each clock tick also pass information about the current state of the
 * media element to sub-parts of the player.
 */

import objectAssign from "object-assign";
import {
  defer as observableDefer,
  fromEvent as observableFromEvent,
  interval as observableInterval,
  merge as observableMerge,
  Observable,
  ReplaySubject,
} from "rxjs";
import {
  map,
  mapTo,
  multicast,
  refCount,
  startWith,
} from "rxjs/operators";
import log from "../../log";
import {
  getLeftSizeOfRange,
  getRange,
} from "../../utils/ranges";

export type IMediaInfosState = "init" | // set once on first emit
                               "canplay" | // HTML5 Event
                               "play" | // HTML5 Event
                               "progress" | // HTML5 Event
                               "seeking" | // HTML5 Event
                               "seeked" | // HTML5 Event
                               "loadedmetadata" | // HTML5 Event
                               "ratechange" | // HTML5 Event
                               "timeupdate"; // Interval

// Global information emitted on each clock tick
export interface IClockTick {
  bufferGap : number; // Gap between `currentTime` and the next position with
                      // bufferred data
  buffered : TimeRanges; // Buffered ranges for the media element
  currentRange : { start : number; // Buffered ranges related to `currentTime`
                   end : number; } |
                 null;
  currentTime : number; // Current position set on the media element
  duration : number; // Current duration set on the media element
  ended: boolean; // Current `ended` value set on the media element
  paused : boolean; // Current `paused` value set on the media element
  playbackRate : number; // Current `playbackRate` set on the mediaElement
  readyState : number; // Current `readyState` value on the media element
  seeking : boolean; // Current `seeking` value on the mediaElement
  state : IMediaInfosState; } // see type

/**
 * HTMLMediaElement Events for which timings are calculated and emitted.
 * @type {Array.<string>}
 */
const SCANNED_MEDIA_ELEMENTS_EVENTS : IMediaInfosState[] = [ "canplay",
                                                             "play",
                                                             "progress",
                                                             "seeking",
                                                             "seeked",
                                                             "loadedmetadata",
                                                             "ratechange" ];

/**
 * Generate a basic timings object from the media element and the eventName
 * which triggered the request.
 * @param {HTMLMediaElement} mediaElement
 * @param {string} currentState
 * @returns {Object}
 */
function getCurrentTick(
  mediaElement : HTMLMediaElement,
  currentState : IMediaInfosState
) : IClockTick {
  const { buffered,
          currentTime,
          duration,
          ended,
          paused,
          playbackRate,
          readyState,
          seeking } = mediaElement;

  return { bufferGap: getLeftSizeOfRange(buffered, currentTime),
           buffered,
           currentRange: getRange(buffered, currentTime),
           currentTime,
           duration,
           ended,
           paused,
           playbackRate,
           readyState,
           seeking,
           state: currentState };
}

/**
 * Timings observable.
 *
 * This Observable samples snapshots of player's current state:
 *   * time position
 *   * playback rate
 *   * current buffered range
 *   * gap with current buffered range ending
 *   * media duration
 *
 * In addition to sampling, this Observable also reacts to "seeking" and "play"
 * events.
 *
 * Observable is shared for performance reason: reduces the number of event
 * listeners and intervals/timeouts but also limit access to the media element
 * properties and gap calculations.
 *
 * The sampling is manual instead of based on "timeupdate" to reduce the
 * number of events.
 * @param {HTMLMediaElement} mediaElement
 * @param {number} maximumUpdateInterval
 * @returns {Observable}
 */
function createClock(
  mediaElement : HTMLMediaElement,
  maximumUpdateInterval : number
) : Observable<IClockTick> {
  return observableDefer(() : Observable<IClockTick> => {
    let lastTimings : IClockTick = objectAssign(getCurrentTick(mediaElement, "init"),
                                                { stalled: null });

    const eventObs : Array< Observable< IMediaInfosState > > =
      SCANNED_MEDIA_ELEMENTS_EVENTS.map((eventName) =>
        observableFromEvent(mediaElement, eventName)
          .pipe(mapTo(eventName)));

    const interval$ : Observable<"timeupdate"> =
      observableInterval(maximumUpdateInterval).pipe(mapTo("timeupdate"));

    return observableMerge(interval$, ...eventObs)
      .pipe(
        map((state : IMediaInfosState) => {
          lastTimings = getCurrentTick(mediaElement, state);
          log.debug("Clock: new clock tick", lastTimings);
          return lastTimings;
        }),
        startWith(lastTimings));
  }).pipe(
    multicast(() => new ReplaySubject<IClockTick>(1)), // Always emit the last
    refCount()
  );
}

export default createClock;
