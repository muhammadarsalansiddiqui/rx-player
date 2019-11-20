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
import { asapScheduler, combineLatest as observableCombineLatest, EMPTY, merge as observableMerge, ReplaySubject, Subject, timer as observableTimer, } from "rxjs";
import { filter, finalize, ignoreElements, map, mapTo, mergeMap, share, startWith, subscribeOn, switchMap, take, takeUntil, tap, } from "rxjs/operators";
import config from "../../config";
import log from "../../log";
import { fromEvent } from "../../utils/event_emitter";
import throttle from "../../utils/rx-throttle";
import ABRManager from "../abr";
import { createManifestPipeline, SegmentPipelinesManager, } from "../pipelines";
import createEMEManager from "./create_eme_manager";
import openMediaSource from "./create_media_source";
import EVENTS from "./events_generators";
import getInitialTime from "./get_initial_time";
import isEMEReadyEvent from "./is_eme_ready";
import createMediaSourceLoader from "./load_on_media_source";
import refreshManifest from "./refresh_manifest";
import throwOnMediaError from "./throw_on_media_error";
var OUT_OF_SYNC_MANIFEST_REFRESH_DELAY = config.OUT_OF_SYNC_MANIFEST_REFRESH_DELAY;
/**
 * Central part of the player.
 *
 * Play a content described by the given Manifest.
 *
 * On subscription:
 *   - Creates the MediaSource and attached sourceBuffers instances.
 *   - download the content's Manifest and handle its refresh logic
 *   - Perform EME management if needed
 *   - get Buffers for each active adaptations.
 *   - give choice of the adaptation to the caller (e.g. to choose a language)
 *   - returns Observable emitting notifications about the content lifecycle.
 * @param {Object} args
 * @returns {Observable}
 */
export default function InitializeOnMediaSource(_a) {
    var adaptiveOptions = _a.adaptiveOptions, autoPlay = _a.autoPlay, bufferOptions = _a.bufferOptions, clock$ = _a.clock$, keySystems = _a.keySystems, lowLatencyMode = _a.lowLatencyMode, mediaElement = _a.mediaElement, networkConfig = _a.networkConfig, speed$ = _a.speed$, startAt = _a.startAt, textTrackOptions = _a.textTrackOptions, pipelines = _a.pipelines, url = _a.url;
    var offlineRetry = networkConfig.offlineRetry, segmentRetry = networkConfig.segmentRetry, manifestRetry = networkConfig.manifestRetry;
    var warning$ = new Subject();
    var manifestPipelines = createManifestPipeline(pipelines, { lowLatencyMode: lowLatencyMode,
        manifestRetry: manifestRetry,
        offlineRetry: offlineRetry }, warning$);
    // Fetch and parse the manifest from the URL given.
    // Throttled to avoid doing multiple simultaneous requests.
    var fetchManifest = throttle(function (manifestURL, externalClockOffset) {
        return manifestPipelines.fetch(manifestURL).pipe(mergeMap(function (response) {
            return manifestPipelines.parse(response.value, manifestURL, externalClockOffset);
        }), share());
    });
    // Creates pipelines for downloading segments.
    var segmentPipelinesManager = new SegmentPipelinesManager(pipelines, { lowLatencyMode: lowLatencyMode,
        offlineRetry: offlineRetry,
        segmentRetry: segmentRetry });
    // Create ABR Manager, which will choose the right "Representation" for a
    // given "Adaptation".
    var abrManager = new ABRManager(adaptiveOptions);
    // Create and open a new MediaSource object on the given media element.
    var openMediaSource$ = openMediaSource(mediaElement).pipe(subscribeOn(asapScheduler), // to launch subscriptions only when all
    share()); // Observables here are linked
    // Send content protection data to EMEManager
    var protectedSegments$ = new Subject();
    // Create EME Manager, an observable which will manage every EME-related
    // issue.
    var emeManager$ = openMediaSource$.pipe(mergeMap(function () { return createEMEManager(mediaElement, keySystems, protectedSegments$); }), subscribeOn(asapScheduler), // to launch subscriptions only when all
    share()); // Observables here are linked
    // Translate errors coming from the media element into RxPlayer errors
    // through a throwing Observable.
    var mediaError$ = throwOnMediaError(mediaElement);
    var loadContent$ = observableCombineLatest([
        openMediaSource$,
        fetchManifest(url, undefined),
        emeManager$.pipe(filter(isEMEReadyEvent), take(1)),
    ]).pipe(mergeMap(function (_a) {
        var initialMediaSource = _a[0], _b = _a[1], manifest = _b.manifest, sendingTime = _b.sendingTime;
        var blacklistUpdates$ = emeManager$.pipe(tap(function (evt) {
            if (evt.type === "blacklist-keys") {
                log.info("Init: blacklisting based on keyIDs");
                manifest.markUndecipherableKIDs(evt.value);
            }
            else if (evt.type === "blacklist-protection-data") {
                log.info("Init: blacklisting based on protection data.");
                manifest.markUndecipherableProtectionData(evt.value.data);
            }
        }));
        log.debug("Init: Calculating initial time");
        var initialTime = getInitialTime(manifest, lowLatencyMode, startAt);
        log.debug("Init: Initial time calculated:", initialTime);
        var mediaSourceLoader = createMediaSourceLoader({
            mediaElement: mediaElement,
            manifest: manifest,
            clock$: clock$,
            speed$: speed$,
            abrManager: abrManager,
            segmentPipelinesManager: segmentPipelinesManager,
            bufferOptions: objectAssign({ textTrackOptions: textTrackOptions }, bufferOptions),
        });
        var recursiveLoad$ = recursivelyLoadOnMediaSource(initialMediaSource, initialTime, autoPlay);
        // Emit each time the manifest is refreshed.
        var manifestRefreshed$ = new ReplaySubject(1);
        // Emit when we want to manually update the manifest.
        // The value allow to set a delay relatively to the last Manifest refresh
        // (to avoid asking for it too often).
        var scheduleManifestRefresh$ = new Subject();
        // Emit when the manifest should be refreshed. Either when:
        //   - A buffer asks for it to be refreshed
        //   - its lifetime expired.
        // TODO if we go a little more clever, manifestRefreshed$ could be removed
        var manifestRefresh$ = manifestRefreshed$.pipe(startWith({ manifest: manifest, sendingTime: sendingTime }), switchMap(function (_a) {
            var newManifest = _a.manifest, newSendingTime = _a.sendingTime;
            var manualRefresh$ = scheduleManifestRefresh$.pipe(mergeMap(function (delay) {
                // schedule a Manifest refresh to avoid sending too much request.
                var timeSinceLastRefresh = newSendingTime == null ?
                    0 :
                    performance.now() - newSendingTime;
                return observableTimer(delay - timeSinceLastRefresh);
            }));
            var autoRefresh$ = (function () {
                if (newManifest.lifetime == null || newManifest.lifetime <= 0) {
                    return EMPTY;
                }
                var timeSinceRequest = newSendingTime == null ?
                    0 :
                    performance.now() - newSendingTime;
                var updateTimeout = newManifest.lifetime * 1000 - timeSinceRequest;
                return observableTimer(updateTimeout);
            })();
            return observableMerge(autoRefresh$, manualRefresh$)
                .pipe(take(1), mergeMap(function () { return refreshManifest(manifest, fetchManifest); }), tap(function (val) { return manifestRefreshed$.next(val); }), ignoreElements());
        }));
        var manifestEvents$ = observableMerge(fromEvent(manifest, "manifestUpdate").pipe(mapTo(EVENTS.manifestUpdate())), fromEvent(manifest, "decipherabilityUpdate")
            .pipe(map(EVENTS.decipherabilityUpdate)));
        return observableMerge(blacklistUpdates$, manifestRefresh$, manifestEvents$, recursiveLoad$)
            .pipe(startWith(EVENTS.manifestReady(manifest)), finalize(function () {
            manifestRefreshed$.complete();
            scheduleManifestRefresh$.complete();
        }));
        /**
         * Load the content defined by the Manifest in the mediaSource given at the
         * given position and playing status.
         * This function recursively re-call itself when a MediaSource reload is
         * wanted.
         * @param {MediaSource} mediaSource
         * @param {number} position
         * @param {boolean} shouldPlay
         * @returns {Observable}
         */
        function recursivelyLoadOnMediaSource(mediaSource, position, shouldPlay) {
            var reloadMediaSource$ = new Subject();
            var mediaSourceLoader$ = mediaSourceLoader(mediaSource, position, shouldPlay)
                .pipe(tap(function (evt) {
                switch (evt.type) {
                    case "needs-manifest-refresh":
                        scheduleManifestRefresh$.next(0);
                        break;
                    case "manifest-might-be-out-of-sync":
                        scheduleManifestRefresh$.next(OUT_OF_SYNC_MANIFEST_REFRESH_DELAY);
                        break;
                    case "needs-media-source-reload":
                        reloadMediaSource$.next(evt.value);
                        break;
                    case "protected-segment":
                        protectedSegments$.next(evt.value);
                }
            }));
            var currentLoad$ = mediaSourceLoader$.pipe(takeUntil(reloadMediaSource$));
            var handleReloads$ = reloadMediaSource$.pipe(switchMap(function (_a) {
                var currentTime = _a.currentTime, isPaused = _a.isPaused;
                return openMediaSource(mediaElement).pipe(mergeMap(function (newMS) { return recursivelyLoadOnMediaSource(newMS, currentTime, !isPaused); }), startWith(EVENTS.reloadingMediaSource()));
            }));
            return observableMerge(handleReloads$, currentLoad$);
        }
    }));
    return observableMerge(loadContent$, mediaError$, emeManager$, warning$.pipe(map(EVENTS.warning)));
}
