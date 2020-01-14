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
  BehaviorSubject,
  Observable,
  ReplaySubject,
} from "rxjs";
import normalizeLanguage from "../../utils/languages";
import {
  IAudioTrackPreference,
  ITextTrackPreference,
  ITMAudioTrack,
  ITMAudioTrackListItem,
  ITMTextTrack,
  ITMTextTrackListItem,
  ITMVideoTrack,
  ITMVideoTrackListItem,
} from "./track_choice_manager";

interface ITMAudioTrackEvent { type: "audio";
                               track: ITMAudioTrack | null; }
interface ITMTextTrackEvent { type: "text";
                              track: ITMTextTrack | null; }
interface ITMVideoTrackEvent { type: "video";
                               track: ITMVideoTrack | null; }
type ITMTrackEvent = ITMAudioTrackEvent | ITMTextTrackEvent | ITMVideoTrackEvent;

// TODO w3c defines an onremovetrack attribute which is not present on
// ts type definition
export interface ICustomTextTrackList extends TextTrackList {
  onremovetrack: ((ev: TrackEvent) => void) | null;
}

let _id = 0;
/**
 * Generate new id at call by incrementing a number
 * @param {string}
 * @returns {string}
 */
function generateId(type: string): string {
  const id = "gen_" + type + "_" + _id.toString();
  _id++;
  return id;
}

function formatAudioTrack(nativeAudioTrack: AudioTrack): ITMAudioTrack {
  const { language } = nativeAudioTrack;
  return { language,
           id: generateId("audio"),
           normalized: normalizeLanguage(language),
           audioDescription: false };
}

function formatVideoTrack(): ITMVideoTrack {
  return { id: generateId("video"),
           representations: [] as [], };
}

function formatTextTrack(nativeTextTrack: TextTrack): ITMTextTrack {
  const { language } = nativeTextTrack;
  return { language,
           id: generateId("text"),
           normalized: normalizeLanguage(language),
           closedCaption: false };
}

/**
 * Manage video, audio and text tracks for current direct file content.
 * @class MediaElementTrackChoiceManager
 */
export default class MediaElementTrackChoiceManager {
  // Array of preferred languages for audio tracks.
  // Sorted by order of preference descending.
  private _preferredAudioTracks : BehaviorSubject<IAudioTrackPreference[]>;

  // Array of preferred languages for text tracks.
  // Sorted by order of preference descending.
  private _preferredTextTracks : BehaviorSubject<ITextTrackPreference[]>;

  private _textTrackChanged$ : ReplaySubject<"video"|"audio"|"text">;
  private _audioTracks : Array<{ track: ITMAudioTrack; origTrack: AudioTrack }>;
  private _textTracks : Array<{ track: ITMTextTrack; origTrack: TextTrack }>;
  private _videoTracks : Array<{ track: ITMVideoTrack; origTrack: VideoTrack }>;

  constructor(
    defaults : { preferredAudioTracks : BehaviorSubject<IAudioTrackPreference[]>;
                 preferredTextTracks : BehaviorSubject<ITextTrackPreference[]>; },
    mediaElement: HTMLMediaElement
  ) {
    const { preferredAudioTracks, preferredTextTracks } = defaults;

    this._textTrackChanged$ = new ReplaySubject();

    this._preferredAudioTracks = preferredAudioTracks;
    this._preferredTextTracks = preferredTextTracks;

    this._audioTracks = [];
    if (mediaElement.audioTracks != null) {
      for (let i = 0; i < mediaElement.audioTracks.length; i++) {
        const audioTrack = mediaElement.audioTracks[i];
        this._audioTracks.push({ track: formatAudioTrack(audioTrack),
                                 origTrack: audioTrack });
      }
      mediaElement.audioTracks.onaddtrack =
        ({ track }) => {
          if (track instanceof AudioTrack) {
            this._audioTracks.push({ track: formatAudioTrack(track),
                                     origTrack: track });
            this._textTrackChanged$.next("audio");
          }
        };
      mediaElement.audioTracks.onremovetrack =
        ({ track }) => {
          for (let i = 0; i < this._audioTracks.length; i++) {
            const audioTrack = this._audioTracks[i];
            if (audioTrack.origTrack === track) {
              this._audioTracks.splice(i, 1);
              this._textTrackChanged$.next("audio");
              return;
            }
          }
        };
    }

    this._textTracks = [];
    if (mediaElement.textTracks != null) {
      for (let i = 0; i < mediaElement.textTracks.length; i++) {
        const textTrack = mediaElement.textTracks[i];
        this._textTracks.push({ track: formatTextTrack(textTrack),
                                origTrack: textTrack });
      }
      mediaElement.textTracks.onaddtrack =
        ({ track }) => {
          if (track instanceof TextTrack) {
            this._textTrackChanged$.next("text");
            this._textTracks.push({ track: formatTextTrack(track),
                                    origTrack: track });
          }
        };
      (mediaElement.textTracks as ICustomTextTrackList).onremovetrack =
        ({ track }) => {
          for (let i = 0; i < this._textTracks.length; i++) {
            const textTrack = this._textTracks[i];
            if (textTrack.origTrack === track) {
              this._textTracks.splice(i, 1);
              this._textTrackChanged$.next("text");
              return;
            }
          }
        };
    }

    this._videoTracks = [];
    if (mediaElement.videoTracks != null) {
      for (let i = 0; i < mediaElement.videoTracks.length; i++) {
        const videoTrack = mediaElement.videoTracks[i];
        this._videoTracks.push({ track: formatVideoTrack(),
                                 origTrack: videoTrack });
      }
      mediaElement.videoTracks.onaddtrack =
        ({ track }) => {
          if (track instanceof VideoTrack) {
            this._textTrackChanged$.next("video");
            this._videoTracks.push({ track: formatVideoTrack(),
                                     origTrack: track });
          }
        };
      mediaElement.videoTracks.onremovetrack =
        ({ track }) => {
          for (let i = 0; i < this._videoTracks.length; i++) {
            const videoTrack = this._videoTracks[i];
            if (videoTrack.origTrack === track) {
              this._videoTracks.splice(i, 1);
              this._textTrackChanged$.next("video");
              return;
            }
          }
        };
    }
  }

  public getAvailableTrackChanges$(): Observable<"video"|"audio"|"text"> {
    return this._textTrackChanged$;
  }

  /**
   * Monitor HTML5 tracks changes
   * @returns {Observable.<Object>}
   */
  public onTrackChange$(mediaElement: HTMLMediaElement): Observable<ITMTrackEvent> {
    return new Observable((obs) => {
      const audioCallback = () => {
        if (this._audioTracks !== undefined) {
          for (let i = 0; i < this._audioTracks.length; i++) {
            const { track, origTrack } = this._audioTracks[i];
            if (origTrack.enabled) {
              return obs.next({ type: "audio",
                                track });
            }
          }
        }
        return obs.next({ type: "audio", track: null });
      };
      const textCallback = () => {
        if (this._textTracks !== undefined) {
          for (let i = 0; i < this._textTracks.length; i++) {
            const { track, origTrack } = this._textTracks[i];
            if (origTrack.mode === "showing") {
              return obs.next({ type: "text",
                                track });
            }
          }
        }
        return obs.next({ type: "text", track: null });
      };
      const videoCallback = () => {
        if (this._videoTracks !== undefined) {
          for (let i = 0; i < this._videoTracks.length; i++) {
            const { track, origTrack } = this._videoTracks[i];
            if (origTrack.selected) {
              obs.next({ type: "video",
                         track });
            }
          }
        }
        return obs.next({ type: "video", track: null });
      };
      mediaElement.audioTracks?.addEventListener("change", audioCallback);
      mediaElement.videoTracks?.addEventListener("change", videoCallback);
      mediaElement.textTracks?.addEventListener("change", textCallback);
      return () => {
        mediaElement.audioTracks?.removeEventListener("change", audioCallback);
        mediaElement.videoTracks?.removeEventListener("change", videoCallback);
        mediaElement.textTracks?.removeEventListener("change", textCallback);
      };
    });
  }

  public setInitialAudioTrack() : void {
    const preferredAudioTracks = this._preferredAudioTracks.getValue();
    const id = this._findFirstOptimalAudioTrackId(
      preferredAudioTracks
        .filter(
          (audioTrack): audioTrack is {
            language : string;
            audioDescription : boolean;
          } => audioTrack !== null)
        .map(({ language }) => normalizeLanguage(language))
    );
    if (id != null) {
      this.setAudioTrackById(id);
    }
  }

  public setInitialTextTrack() : void {
    const preferredTextTracks = this._preferredTextTracks.getValue();
    const id = this._findFirstOptimalTextTrackId(
      preferredTextTracks
        .filter(
          (textTrack): textTrack is { language : string;
                                      closedCaption : boolean; } => textTrack !== null)
        .map(({ language }) =>  normalizeLanguage(language))
    );
    if (id !== null) {
      this.setTextTrackById(id);
    }
  }

  public setAudioTrackById(id?: string|number): void {
    for (let i = 0; i < this._audioTracks.length; i++) {
      const { track, origTrack } = this._audioTracks[i];
      if (track.id === id) {
        origTrack.enabled = true;
      }
    }
  }

  public setTextTrackById(id?: string|number): void {
    for (let i = 0; i < this._textTracks.length; i++) {
      const { track, origTrack } = this._textTracks[i];
      if (track.id === id) {
        origTrack.mode = "showing";
      } else if (origTrack.mode === "showing" || origTrack.mode === "hidden") {
        origTrack.mode = "disabled";
      }
    }
  }

  public setVideoTrackById(id?: string): void {
    for (let i = 0; i < this._videoTracks.length; i++) {
      const { track, origTrack } = this._videoTracks[i];
      if (track.id === id) {
        origTrack.selected = true;
      }
    }
  }

  public getChosenAudioTrack(): ITMAudioTrack|null|undefined {
    for (let i = 0; i < this._audioTracks.length; i++) {
      const { track, origTrack } = this._audioTracks[i];
      if (origTrack.enabled) {
        return track;
      }
    }
    return null;
  }

  public getChosenTextTrack(): ITMTextTrack|null|undefined {
    for (let i = 0; i < this._textTracks.length; i++) {
      const { track, origTrack } = this._textTracks[i];
      if (origTrack.mode === "showing") {
        return track;
      }
    }
    return null;
  }

  public getChosenVideoTrack(): ITMVideoTrack|null|undefined {
    for (let i = 0; i < this._videoTracks.length; i++) {
      const { track, origTrack } = this._videoTracks[i];
      if (origTrack.selected) {
        return track;
      }
    }
    return null;
  }

  public getAvailableAudioTracks(): ITMAudioTrackListItem[]|undefined {
    return this._audioTracks.map(({ track, origTrack }) => {
      return objectAssign(track, { active: origTrack.enabled });
    });
  }

  public getAvailableTextTracks(): ITMTextTrackListItem[]|undefined {
    return this._textTracks.map(({ track, origTrack }) => {
      return objectAssign(track, { active: origTrack.mode === "showing" });
    });
  }

  public getAvailableVideoTracks(): ITMVideoTrackListItem[]|undefined {
    return this._videoTracks.map(({ track, origTrack }) => {
      return objectAssign(track, { active: origTrack.selected });
    });
  }

  private _findFirstOptimalAudioTrackId(
    normalizedLanguages: string[]
  ): string|number|null|undefined {
    for (let i = 0; i < normalizedLanguages.length; i++) {
      const language = normalizedLanguages[i];
      for (let j = 0; j < this._audioTracks.length; j++) {
        const audioTrack = this._audioTracks[j];
        const normalizedLanguage = audioTrack.track.normalized;
        if (normalizedLanguage === language) {
          return audioTrack.track.id;
        }
      }
    }
    return null;
  }

  private _findFirstOptimalTextTrackId(
    normalizedLanguages: string[]
  ): string|number|null|undefined {
    for (let i = 0; i < normalizedLanguages.length; i++) {
      const language = normalizedLanguages[i];
      for (let j = 0; j < this._textTracks.length; j++) {
        const textTrack = this._textTracks[j];
        const normalizedLanguage = textTrack.track.normalized;
        if (normalizedLanguage === language) {
          return textTrack.track.id;
        }
      }
    }
    return null;
  }
}
