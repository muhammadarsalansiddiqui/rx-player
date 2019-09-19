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

import { ICustomError } from "../../errors";
import Manifest from "../../manifest";
import { IRepresentationChangeEvent } from "../buffers";

// Object emitted when the clock ticks
export interface IClockTick { currentTime : number;
                              bufferGap : number;
                              buffered : TimeRanges;
                              currentRange : { start : number;
                                               end : number; } |
                                             null;
                              duration : number;
                              ended : boolean;
                              paused : boolean;
                              playbackRate : number;
                              readyState : number;
                              seeking : boolean;
                              state : string; }

export interface IStallingItem {
  reason : "seeking" | // Building buffer after seeking
           "not-ready" | // Building buffer after low readyState
           "buffering"; // Other cases
  timestamp : number; // `performance.now` at the time the
                      // stalling happened
}

export interface IInitClockTick extends IClockTick {
  stalled : IStallingItem | null;
}

// The manifest has been downloaded and parsed for the first time
export interface IManifestReadyEvent { type : "manifestReady";
                                       value : { manifest : Manifest }; }

// A minor error happened
export interface IWarningEvent { type : "warning";
                                 value : ICustomError; }

export interface IReloadingMediaSourceEvent { type: "reloading-media-source";
                                              value: undefined; }

// The current playback rate changed.
// Note: it can be a change wanted by the user or even a manual `0` speed
// setting to build a buffer.
export interface ISpeedChangedEvent { type : "speedChanged";
                                      value : number; }

// The player stalled, leading to buffering.
export interface IStalledEvent { type : "stalled";
                                 value : IStallingItem|null; }

// The content loaded
export interface ILoadedEvent { type : "loaded";
                                value : true; }

export { IRepresentationChangeEvent };
