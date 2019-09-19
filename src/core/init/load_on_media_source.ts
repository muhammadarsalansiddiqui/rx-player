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

import {
  BehaviorSubject,
  EMPTY,
  merge as observableMerge,
  Observable,
  of as observableOf,
  Subject,
} from "rxjs";
import {
  filter,
  finalize,
  ignoreElements,
  map,
  mergeMap,
  takeUntil,
} from "rxjs/operators";
import { MediaError } from "../../errors";
import log from "../../log";
import Manifest, {
  Period,
} from "../../manifest";
import ABRManager from "../abr";
import BufferOrchestrator, {
  IBufferOrchestratorEvent,
} from "../buffers";
import { SegmentPipelinesManager } from "../pipelines";
import SourceBuffersStore, {
  ITextTrackSourceBufferOptions,
} from "../source_buffers";
import createBufferClock from "./create_buffer_clock";
import { setDurationToMediaSource } from "./create_media_source";
import { maintainEndOfStream } from "./end_of_stream";
import EVENTS from "./events_generators";
import seekAndLoadOnMediaEvents from "./initial_seek_and_play";
import {
  IInitClockTick,
  ILoadedEvent,
  ISpeedChangedEvent,
  IStalledEvent,
  IWarningEvent,
} from "./types";
import updatePlaybackRate from "./update_playback_rate";

// Arguments needed by createMediaSourceLoader
export interface IMediaSourceLoaderArguments {
  abrManager : ABRManager;
  bufferOptions : { // Buffers-related options
    wantedBufferAhead$ : BehaviorSubject<number>;
    maxBufferAhead$ : Observable<number>;
    maxBufferBehind$ : Observable<number>;
    textTrackOptions : ITextTrackSourceBufferOptions;
    manualBitrateSwitchingMode : "seamless"|"direct";
  };
  clock$ : Observable<IInitClockTick>; // Emit position information
  manifest : Manifest; // Manifest of the content we want to
                                         // play
  mediaElement : HTMLMediaElement; // Media Element on which the content will be
                                   // played
  segmentPipelinesManager : SegmentPipelinesManager<any>;
  speed$ : Observable<number>; // Emit the speed.
                               // /!\ Should replay the last value on subscription.
}

// Events emitted when loading content in the MediaSource
export type IMediaSourceLoaderEvent = IStalledEvent |
                                      ISpeedChangedEvent |
                                      ILoadedEvent |
                                      IWarningEvent |
                                      IBufferOrchestratorEvent;

/**
 * Returns a function allowing to load or reload the content in arguments into
 * a single or multiple MediaSources.
 * @param {Object} args
 * @returns {Observable}
 */
export default function createMediaSourceLoader({
  abrManager,
  bufferOptions,
  clock$,
  manifest,
  mediaElement,
  segmentPipelinesManager,
  speed$,
} : IMediaSourceLoaderArguments) : (
  mediaSource : MediaSource,
  position : number,
  autoPlay : boolean
) => Observable<IMediaSourceLoaderEvent> {
  /**
   * Load the content on the given MediaSource.
   * @param {MediaSource} mediaSource
   * @param {number} initialTime
   * @param {boolean} autoPlay
   */
  return function loadContentOnMediaSource(
    mediaSource : MediaSource,
    initialTime : number,
    autoPlay : boolean
  ) {
    // TODO Update the duration if it evolves?
    const duration = manifest.getDuration();
    setDurationToMediaSource(mediaSource, duration == null ? Infinity :
                                                             duration);

    const initialPeriod = manifest.getPeriodForTime(initialTime);
    if (initialPeriod == null) {
      throw new MediaError("MEDIA_STARTING_TIME_NOT_FOUND",
                           "Wanted starting time not found in the Manifest.");
    }

    // Creates SourceBuffersStore allowing to create and keep track of a
    // single SourceBuffer per type.
    const sourceBuffersStore = new SourceBuffersStore(mediaElement, mediaSource);

    // Initialize all native source buffers from the first period at the same
    // time.
    // We cannot lazily create native sourcebuffers since the spec does not
    // allow adding them during playback.
    //
    // From https://w3c.github.io/media-source/#methods
    //    For example, a user agent may throw a QuotaExceededError
    //    exception if the media element has reached the HAVE_METADATA
    //    readyState. This can occur if the user agent's media engine
    //    does not support adding more tracks during playback.
    createNativeSourceBuffersForPeriod(sourceBuffersStore, initialPeriod);

    const { seek$, load$ } =
      seekAndLoadOnMediaEvents(clock$, mediaElement, initialTime, autoPlay);

    const initialPlay$ = load$.pipe(filter((evt) => evt !== "not-loaded-metadata"));
    const bufferClock$ = createBufferClock(clock$, { autoPlay,
                                                     initialPlay$,
                                                     initialSeek$: seek$,
                                                     manifest,
                                                     speed$,
                                                     startTime: initialTime });

    // Will be used to cancel any endOfStream tries when the contents resume
    const cancelEndOfStream$ = new Subject<null>();

    // Creates Observable which will manage every Buffer for the given Content.
    const buffers$ = BufferOrchestrator({ manifest, initialPeriod },
                                        bufferClock$,
                                        abrManager,
                                        sourceBuffersStore,
                                        segmentPipelinesManager,
                                        bufferOptions
    ).pipe(
      mergeMap((evt) : Observable<IMediaSourceLoaderEvent> => {
        switch (evt.type) {
          case "end-of-stream":
            log.debug("Init: end-of-stream order received.");
            return maintainEndOfStream(mediaSource).pipe(
              ignoreElements(),
              takeUntil(cancelEndOfStream$));
          case "resume-stream":
            log.debug("Init: resume-stream order received.");
            cancelEndOfStream$.next(null);
            return EMPTY;
          case "discontinuity-encountered":
            if (SourceBuffersStore.isNative(evt.value.bufferType)) {
              log.warn("Init: Explicit discontinuity seek", evt.value.nextTime);
              mediaElement.currentTime = evt.value.nextTime;
            }
            return EMPTY;
          default:
            return observableOf(evt);
        }
      })
    );

    // update the speed set by the user on the media element while pausing a
    // little longer while the buffer is empty.
    const playbackRate$ = updatePlaybackRate(mediaElement, clock$, speed$)
      .pipe(map(EVENTS.speedChanged));
    const stalled$ = clock$.pipe(map((tick => EVENTS.stalled(tick.stalled))));

    const loadedEvent$ = load$
      .pipe(mergeMap((evt) => {
        if (evt === "autoplay-blocked") {
          const error = new MediaError("MEDIA_ERR_BLOCKED_AUTOPLAY",
                                       "Cannot trigger auto-play automatically: " +
                                       "your browser does not allow it.");
          return observableOf(EVENTS.warning(error), EVENTS.loaded());
        } else if (evt === "not-loaded-metadata") {
          const error = new MediaError("MEDIA_ERR_NOT_LOADED_METADATA",
                                       "Cannot load automatically: your browser " +
                                       "falsely announced having loaded the content.");
          return observableOf(EVENTS.warning(error));
        }
        log.debug("Init: The current content is loaded.");
        return observableOf(EVENTS.loaded());
      }));

    return observableMerge(loadedEvent$, playbackRate$, stalled$, buffers$)
      .pipe(finalize(() => {
        // clean-up every created SourceBuffers
        sourceBuffersStore.disposeAll();
      }));
  };
}

/**
 * Create all native SourceBuffers needed for a given Period.
 *
 * Native Buffers have the particulary to need to be created at the beginning of
 * the content.
 * Custom source buffers (entirely managed in JS) can generally be created and
 * disposed at will during the lifecycle of the content.
 * @param {SourceBuffersStore} sourceBuffersStore
 * @param {Period} period
 */
function createNativeSourceBuffersForPeriod(
  sourceBuffersStore : SourceBuffersStore,
  period : Period
) : void {
  Object.keys(period.adaptations).forEach(bufferType => {
    if (SourceBuffersStore.isNative(bufferType)) {
      const adaptations = period.adaptations[bufferType] || [];
      const representations = adaptations != null &&
                              adaptations.length ? adaptations[0].representations :
                                                   [];
      if (representations.length) {
        const codec = representations[0].getMimeTypeString();
        sourceBuffersStore.createSourceBuffer(bufferType, codec);
      }
    }
  });
}
