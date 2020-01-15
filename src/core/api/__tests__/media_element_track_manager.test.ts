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
import MediaElementTrackManager from "../media_element_track_manager";

const fakeMediaElement = {
  audioTracks: [
    { language: "en", enabled: false },
    { language: "fr", enabled: true },
    { language: "el", enabled: false },
    { language: "pt-BR", enabled: false },
  ],
  textTracks: [
    { language: "en", mode: "hidden" },
    { language: "fr", mode: "showing" },
    { language: "el", mode: "hidden" },
    { language: "pt-BR", mode: "hidden" },
  ],
  videoTracks: [
    { language: "", selected: true },
  ],
};

describe("API - MediaElementTrackManager", () => {
  it("should returns correct results for getter", () => {
      const trackManager = new MediaElementTrackManager(
        {
          preferredAudioTracks: new BehaviorSubject([] as any[]),
          preferredTextTracks: new BehaviorSubject([] as any[]),
        },
        fakeMediaElement as any
      );
      const audioTracks = trackManager.getAvailableAudioTracks();
      const textTracks = trackManager.getAvailableTextTracks();
      const videoTracks = trackManager.getAvailableVideoTracks();
      expect(audioTracks).toBeDefined();
      expect(audioTracks?.length).toBe(4);
      expect(videoTracks).toBeDefined();
      expect(videoTracks?.length).toBe(1);
      expect(textTracks).toBeDefined();
      expect(textTracks?.length).toBe(4);

      const chosenAudioTrack = trackManager.getChosenAudioTrack();
      const chosenTextTrack = trackManager.getChosenTextTrack();
      const chosenVideoTrack = trackManager.getChosenVideoTrack();
      expect(chosenAudioTrack).toEqual({
        id: "gen_audio_fr_1",
        language: "fr",
        audioDescription: false,
        normalized: "fra",
      });
      expect(chosenVideoTrack).toEqual({
        id: "gen_video_nolang_1",
        representations: [],
      });
      expect(chosenTextTrack).toEqual({
        id: "gen_text_fr_1",
        language: "fr",
        closedCaption: false,
        normalized: "fra",
      });
  });
  it("should returns correct results for setters", () => {
      const trackManager = new MediaElementTrackManager(
        {
          preferredAudioTracks: new BehaviorSubject([] as any[]),
          preferredTextTracks: new BehaviorSubject([] as any[]),
        },
        fakeMediaElement as any
      );

      trackManager.setAudioTrackById("gen_audio_en_1");
      // unset enabled attribute of other track, as browser is supported to do this
      fakeMediaElement.audioTracks[1].enabled = false;
      expect(trackManager.getChosenAudioTrack()).toEqual({
        id: "gen_audio_en_1",
        language: "en",
        audioDescription: false,
        normalized: "eng",
      });

      trackManager.setTextTrackById("gen_text_en_1");
      // changed mode attribute of other track, as browser is supported to do this
      fakeMediaElement.textTracks[1].mode = "hidden";
      expect(trackManager.getChosenTextTrack()).toEqual({
        id: "gen_text_en_1",
        language: "en",
        closedCaption: false,
        normalized: "eng",
      });
  });
  it("should emit available tracks change when changing text contents", (done) => {
    const trackManager = new MediaElementTrackManager(
      {
        preferredAudioTracks: new BehaviorSubject([] as any[]),
        preferredTextTracks: new BehaviorSubject([] as any[]),
      },
      fakeMediaElement as any
    );

    trackManager
      .addEventListener("availableTracksChange", ({ type }: { type: string }) => {
        expect(type).toBe("text");
        done();
      });

    // Fake browser behavior
    fakeMediaElement.textTracks.push({ language: "en", mode: "hidden" });
    /* tslint:disable-next-line */
    (fakeMediaElement.textTracks as any).onaddtrack();
  });

  it("should emit available tracks change when changing video contents", (done) => {
    const trackManager = new MediaElementTrackManager(
      {
        preferredAudioTracks: new BehaviorSubject([] as any[]),
        preferredTextTracks: new BehaviorSubject([] as any[]),
      },
      fakeMediaElement as any
    );

    trackManager
      .addEventListener("availableTracksChange", ({ type }: { type: string }) => {
        expect(type).toBe("video");
        done();
      });

    // Fake browser behavior
    fakeMediaElement.videoTracks.push({ language: "en", selected: false });
    /* tslint:disable-next-line */
    (fakeMediaElement.videoTracks as any).onaddtrack();
  });

  it("should emit available tracks change when changing audio contents", (done) => {
    const trackManager = new MediaElementTrackManager(
      {
        preferredAudioTracks: new BehaviorSubject([] as any[]),
        preferredTextTracks: new BehaviorSubject([] as any[]),
      },
      fakeMediaElement as any
    );

    trackManager
      .addEventListener("availableTracksChange", ({ type }: { type: string }) => {
        expect(type).toBe("audio");
        done();
      });

    // Fake browser behavior
    fakeMediaElement.audioTracks.push({ language: "en", enabled: false });
    /* tslint:disable-next-line */
    (fakeMediaElement.audioTracks as any).onaddtrack();
  });

  it("should emit chosen track when changing text content", (done) => {
    const trackManager = new MediaElementTrackManager(
      {
        preferredAudioTracks: new BehaviorSubject([] as any[]),
        preferredTextTracks: new BehaviorSubject([] as any[]),
      },
      fakeMediaElement as any
    );

    trackManager
      .addEventListener("trackChange", ({ type }: { type: string }) => {
        expect(type).toBe("text");
        const chosenTrack = trackManager.getChosenTextTrack();
        expect(chosenTrack?.id).toBe("gen_text_fr_1");
        done();
      });

    trackManager.setTextTrackById("gen_text_fr_1");

    // Fake browser behavior
    fakeMediaElement.textTracks[0].mode = "hidden";
    /* tslint:disable-next-line */
    (fakeMediaElement.textTracks as any).onchange();
  });
});
