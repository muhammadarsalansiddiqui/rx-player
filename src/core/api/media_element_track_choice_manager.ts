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

import { BehaviorSubject } from "rxjs";
import EventEmitter from "../../utils/event_emitter";
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

// TODO w3c defines an onremovetrack attribute which is not present on
// ts type definition
export interface ICustomTextTrackList extends TextTrackList {
  onremovetrack: ((ev: TrackEvent) => void) | null;
  onchange: (() => void) | null;
}

interface IMediaElementTrackChoiceManagerEvents {
  availableTracksChange: "audio"|"video"|"text";
  trackChange:
    { type: "audio"; track: ITMAudioTrack|null } |
    { type: "video"; track: ITMVideoTrack|null } |
    { type: "text"; track: ITMTextTrack|null };
}

/**
 * Manage video, audio and text tracks for current direct file content.
 * @class MediaElementTrackChoiceManager
 */
export default class MediaElementTrackChoiceManager
  extends EventEmitter<IMediaElementTrackChoiceManagerEvents> {
  // Array of preferred languages for audio tracks.
  // Sorted by order of preference descending.
  private _preferredAudioTracks : BehaviorSubject<IAudioTrackPreference[]>;

  // Array of preferred languages for text tracks.
  // Sorted by order of preference descending.
  private _preferredTextTracks : BehaviorSubject<ITextTrackPreference[]>;

  private _audioTracks : Array<{ track: ITMAudioTrack; origTrack: AudioTrack }>;
  private _textTracks : Array<{ track: ITMTextTrack; origTrack: TextTrack }>;
  private _videoTracks : Array<{ track: ITMVideoTrack; origTrack: VideoTrack }>;

  private _mediaElement : HTMLMediaElement;

  constructor(
    defaults : { preferredAudioTracks : BehaviorSubject<IAudioTrackPreference[]>;
                 preferredTextTracks : BehaviorSubject<ITextTrackPreference[]>; },
    mediaElement: HTMLMediaElement
  ) {
    super();
    const { preferredAudioTracks, preferredTextTracks } = defaults;

    this._preferredAudioTracks = preferredAudioTracks;
    this._preferredTextTracks = preferredTextTracks;

    this._mediaElement = mediaElement;

    /**
     * Check if track array is different from an other one
     * @param {Array.<Object>} oldTrackArray
     * @param {Array.<Object>} newTrackArray
     * @returns {boolean}
     */
    function areTrackArraysDifferent(
      oldTrackArray: Array<{ origTrack: VideoTrack|AudioTrack|TextTrack }>,
      newTrackArray: Array<{ origTrack: VideoTrack|AudioTrack|TextTrack }>
    ) {
      if (newTrackArray.length !== oldTrackArray.length) {
        return true;
      }
      for (let i = 0; i < newTrackArray.length; i++) {
        if (newTrackArray[i].origTrack !== oldTrackArray[i]?.origTrack) {
          return true;
        }
      }
      return false;
    }

    // Create audio tracks from native audio tracks.
    const createAudioTracks = (): Array<{ track: { id: string;
                                                   normalized: string;
                                                   language: string;
                                                   audioDescription: boolean; };
                                          origTrack: AudioTrack; }> => {
      const newAudioTracks = [];
      const { audioTracks } = mediaElement;
      const languagesOccurences: Partial<Record<string, number>> = {};
      for (let i = 0; i < audioTracks.length; i++) {
        const audioTrack = audioTracks[i];
        const language = audioTrack.language === "" ? "nolang" :
                                                      audioTrack.language;
        const occurences = languagesOccurences[language] ?? 1;
        const id = "gen_audio_" +
                   language +
                   "_" +
                   occurences.toString();
        languagesOccurences[language] = occurences + 1;
        const track = { language: audioTrack.language,
                        id,
                        normalized: normalizeLanguage(audioTrack.language),
                        audioDescription: false };
        newAudioTracks.push({ track,
                              origTrack: audioTrack });
      }
      return newAudioTracks;
    };

    this._audioTracks = [];
    if (mediaElement.audioTracks != null) {
      this._audioTracks = createAudioTracks();
      mediaElement.audioTracks.onaddtrack = () => {
        const newAudioTracks = createAudioTracks();
        if (areTrackArraysDifferent(this._audioTracks, newAudioTracks)) {
          this._audioTracks = newAudioTracks;
          this._setInitialAudioTrack();
          this.trigger("availableTracksChange", "audio");
        }
      };
      mediaElement.audioTracks.onremovetrack = () => {
        const newAudioTracks = createAudioTracks();
        if (areTrackArraysDifferent(this._audioTracks, newAudioTracks)) {
          this._audioTracks = newAudioTracks;
          this._setInitialAudioTrack();
          this.trigger("availableTracksChange", "audio");
        }
      };
    }

    // Create text tracks from native text tracks.
    const createTextTracks = (): Array<{ track: { id: string;
                                                  normalized: string;
                                                  language: string;
                                                  closedCaption: boolean; };
                                         origTrack: TextTrack; }> => {
      const { textTracks } = mediaElement;
      const newTextTracks = [];
      const languagesOccurences: Partial<Record<string, number>> = {};
      for (let i = 0; i < textTracks.length; i++) {
        const textTrack = textTracks[i];
        const language = textTrack.language === "" ? "nolang" :
                                                     textTrack.language;
        const occurences = languagesOccurences[language] ?? 1;
        const id = "gen_text_" +
                   language +
                   "_" +
                   occurences.toString();
        languagesOccurences[language] = occurences + 1;
        const track =  { language: textTrack.language,
                         id,
                         normalized: normalizeLanguage(textTrack.language),
                         closedCaption: false };
        newTextTracks.push({ track,
                             origTrack: textTrack });
      }
      return newTextTracks;
    };

    this._textTracks = [];
    if (mediaElement.textTracks != null) {
      this._textTracks = createTextTracks();
      mediaElement.textTracks.onaddtrack = () => {
        const newTextTracks = createTextTracks();
        if (areTrackArraysDifferent(this._textTracks, newTextTracks)) {
          this._textTracks = newTextTracks;
          this._setInitialTextTrack();
          this.trigger("availableTracksChange", "text");
        }
      };
      (mediaElement.textTracks as ICustomTextTrackList).onremovetrack = () => {
        const newTextTracks = createTextTracks();
        if (areTrackArraysDifferent(this._textTracks, newTextTracks)) {
          this._textTracks = newTextTracks;
          this._setInitialTextTrack();
          this.trigger("availableTracksChange", "text");
        }
      };
    }

    // Create video tracks from native video tracks.
    const createVideoTracks = (): Array<{ track: { id: string;
                                                   representations: []; };
                                          origTrack: VideoTrack; }> => {
      const newVideoTracks = [];
      const { videoTracks } = mediaElement;
      const languagesOccurences: Partial<Record<string, number>> = {};
      for (let i = 0; i < videoTracks.length; i++) {
        const videoTrack = videoTracks[i];
        const language = videoTrack.language === "" ? "nolang" :
                                                      videoTrack.language;
        const occurences = languagesOccurences[language] ?? 1;
        const id = "gen_video_" +
                   language +
                   "_" +
                   occurences.toString();
        languagesOccurences[language] = occurences + 1;
        newVideoTracks.push({ track: { id,
                                       representations: [] as [] },
                              origTrack: videoTrack });
      }
      return newVideoTracks;
    };

    this._videoTracks = [];
    if (mediaElement.videoTracks != null) {
      this._videoTracks = createVideoTracks();
      mediaElement.videoTracks.onaddtrack = () => {
        const newVideoTracks = createVideoTracks();
        if (areTrackArraysDifferent(this._videoTracks, newVideoTracks)) {
          this._videoTracks = newVideoTracks;
          this.trigger("availableTracksChange", "video");
        }
      };
      mediaElement.videoTracks.onremovetrack = () => {
        const newVideoTracks = createVideoTracks();
        if (areTrackArraysDifferent(this._videoTracks, newVideoTracks)) {
          this._videoTracks = newVideoTracks;
          this.trigger("availableTracksChange", "video");
        }
      };
    }

    this._onTrackChange(mediaElement);
  }

  public setAudioTrackById(id?: string|number): void {
    for (let i = 0; i < this._audioTracks.length; i++) {
      const { track, origTrack } = this._audioTracks[i];
      if (track.id === id) {
        origTrack.enabled = true;
        return;
      }
    }
    throw new Error("Audio track not found.");
  }

  public disableTextTrack(): void {
    for (let i = 0; i < this._textTracks.length; i++) {
      const { origTrack } = this._textTracks[i];
      origTrack.mode = "disabled";
    }
  }

  public setTextTrackById(id?: string|number): void {
    let hasSetTrack = false;
    for (let i = 0; i < this._textTracks.length; i++) {
      const { track, origTrack } = this._textTracks[i];
      if (track.id === id) {
        origTrack.mode = "showing";
        hasSetTrack = true;
      } else if (origTrack.mode === "showing" || origTrack.mode === "hidden") {
        origTrack.mode = "disabled";
      }
    }
    if (!hasSetTrack) {
      throw new Error("Text track not found.");
    }
  }

  public setVideoTrackById(id?: string): void {
    for (let i = 0; i < this._videoTracks.length; i++) {
      const { track, origTrack } = this._videoTracks[i];
      if (track.id === id) {
        origTrack.selected = true;
        return;
      }
    }
    throw new Error("Video track not found.");
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
      return { id: track.id,
               language: track.language,
               normalized: track.normalized,
               audioDescription: track.audioDescription,
               active: origTrack.enabled };
    });
  }

  public getAvailableTextTracks(): ITMTextTrackListItem[]|undefined {
    return this._textTracks.map(({ track, origTrack }) => {
      return { id: track.id,
               language: track.language,
               normalized: track.normalized,
               closedCaption: track.closedCaption,
               active: origTrack.mode === "showing" };
    });
  }

  public getAvailableVideoTracks(): ITMVideoTrackListItem[]|undefined {
    return this._videoTracks.map(({ track, origTrack }) => {
      return { id: track.id,
               representations: track.representations,
               active: origTrack.selected };
    });
  }

  public dispose(): void {
    this._mediaElement.videoTracks.onchange = null;
    this._mediaElement.videoTracks.onaddtrack = null;
    this._mediaElement.videoTracks.onremovetrack = null;

    this._mediaElement.audioTracks.onchange = null;
    this._mediaElement.audioTracks.onaddtrack = null;
    this._mediaElement.audioTracks.onremovetrack = null;

    (this._mediaElement.textTracks as ICustomTextTrackList).onchange = null;
    this._mediaElement.textTracks.onaddtrack = null;
    (this._mediaElement.textTracks as ICustomTextTrackList).onremovetrack = null;

    this.removeEventListener();
  }

  private _setInitialAudioTrack() : void {
    const preferredAudioTracks = this._preferredAudioTracks.getValue();
    const normalizedLanguages = preferredAudioTracks
      .filter(
        (audioTrack): audioTrack is {
          language : string;
          audioDescription : boolean;
        } => audioTrack !== null)
      .map(({ language }) => normalizeLanguage(language));

    for (let i = 0; i < normalizedLanguages.length; i++) {
      const language = normalizedLanguages[i];
      for (let j = 0; j < this._audioTracks.length; j++) {
        const audioTrack = this._audioTracks[j];
        const normalizedLanguage = audioTrack.track.normalized;
        if (normalizedLanguage === language) {
          this.setAudioTrackById(audioTrack.track.id);
          return;
        }
      }
    }
  }

  private _setInitialTextTrack() : void {
    const preferredTextTracks = this._preferredTextTracks.getValue();
    const normalizedLanguages = preferredTextTracks
      .filter(
        (textTrack): textTrack is { language : string;
                                    closedCaption : boolean; } => textTrack !== null)
      .map(({ language }) =>  normalizeLanguage(language));

    for (let i = 0; i < normalizedLanguages.length; i++) {
      const language = normalizedLanguages[i];
      for (let j = 0; j < this._textTracks.length; j++) {
        const textTrack = this._textTracks[j];
        const normalizedLanguage = textTrack.track.normalized;
        if (normalizedLanguage === language) {
          this.setTextTrackById(textTrack.track.id);
          return;
        }
      }
    }
  }

  /**
   * Monitor HTML5 tracks changes
   */
  private _onTrackChange(mediaElement: HTMLMediaElement): void {
    const audioCallback = () => {
      if (this._audioTracks !== undefined) {
        for (let i = 0; i < this._audioTracks.length; i++) {
          const { track, origTrack } = this._audioTracks[i];
          if (origTrack.enabled) {
            this.trigger("trackChange", { type: "audio",
                                          track });
            return;
          }
        }
      }
      this.trigger("trackChange", { type: "audio",
                                    track: null });
      return;
    };
    const textCallback = () => {
      if (this._textTracks !== undefined) {
        for (let i = 0; i < this._textTracks.length; i++) {
          const { track, origTrack } = this._textTracks[i];
          if (origTrack.mode === "showing") {
            this.trigger("trackChange", { type: "text",
                                          track });
            return;
          }
        }
      }
      this.trigger("trackChange", { type: "text",
                                    track: null });
      return;
    };
    const videoCallback = () => {
      if (this._videoTracks !== undefined) {
        for (let i = 0; i < this._videoTracks.length; i++) {
          const { track, origTrack } = this._videoTracks[i];
          if (origTrack.selected) {
            this.trigger("trackChange", { type: "video",
                                          track });
            return;
          }
        }
      }
      this.trigger("trackChange", { type: "video",
                                    track: null });
      return;
    };
    if (mediaElement.audioTracks !== undefined) {
      mediaElement.audioTracks.onchange = audioCallback;
    }
    if (mediaElement.textTracks !== undefined) {
      (mediaElement.textTracks as ICustomTextTrackList).onchange = textCallback;
    }
    if (mediaElement.videoTracks !== undefined) {
      mediaElement.videoTracks.onchange = videoCallback;
    }
  }
}
