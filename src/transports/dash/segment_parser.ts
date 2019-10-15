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

import { of as observableOf } from "rxjs";
import {
  getMDHDTimescale,
  getSegmentsFromSidx,
  takePSSHOut,
} from "../../parsers/containers/isobmff";
import {
  getSegmentsFromCues,
  getTimeCodeScale,
} from "../../parsers/containers/matroska";
import takeFirstSet from "../../utils/take_first_set";
import {
  ISegmentParserArguments,
  ISegmentParserObservable,
} from "../types";
import getISOBMFFTimingInfos from "../utils/get_isobmff_timing_infos";
import isWEBMEmbeddedTrack from "../utils/is_webm_embedded_track";

export default function parser(
  { content,
    response,
    init } : ISegmentParserArguments< Uint8Array |
                                      ArrayBuffer |
                                      null >
) : ISegmentParserObservable< Uint8Array | ArrayBuffer > {
  const { period, representation, segment } = content;
  const { data, isChunked } = response;
  if (data == null) {
    return observableOf({ chunkData: null,
                          chunkInfos: null,
                          chunkOffset: 0,
                          segmentProtections: [],
                          appendWindow: [period.start, period.end] });
  }

  const chunkData = data instanceof Uint8Array ? data :
                                                 new Uint8Array(data);
  const isWEBM = isWEBMEmbeddedTrack(representation);

  if (!segment.isInit) {
    const chunkInfos = isWEBM ? null : // TODO extract from webm
                                getISOBMFFTimingInfos(chunkData,
                                                      isChunked,
                                                      segment,
                                                      init);
    return observableOf({ chunkData,
                          chunkInfos,
                          chunkOffset: takeFirstSet<number>(segment.timestampOffset,
                                                            0),
                          segmentProtections: [],
                          appendWindow: [period.start, period.end] });
  }

  // it is an initialization segment

  const { indexRange } = segment;
  const nextSegments = isWEBM ?
    getSegmentsFromCues(chunkData, 0) :
    getSegmentsFromSidx(chunkData, Array.isArray(indexRange) ? indexRange[0] :

                                                               0);

  if (!isWEBM) {
    const psshInfo = takePSSHOut(chunkData);
    if (psshInfo.length > 0) {
      for (let i = 0; i < psshInfo.length; i++) {
        const { systemID, data: psshData } = psshInfo[i];
        representation._addProtectionData("cenc", systemID, psshData);
      }
    }
  }

  const segmentProtections = representation.getProtectionsInitializationData();

  if (nextSegments !== null && nextSegments.length > 0) {
    representation.index._addSegments(nextSegments);
  }

  const timescale = isWEBM ? getTimeCodeScale(chunkData, 0) :
                             getMDHDTimescale(chunkData);
  const initChunkInfos = timescale != null && timescale > 0 ? { time: 0,
                                                                duration: 0,
                                                                timescale } :
                                                              null;
  return observableOf({ chunkData,
                        chunkInfos: initChunkInfos,
                        chunkOffset: takeFirstSet<number>(segment.timestampOffset, 0),
                        segmentProtections,
                        appendWindow: [period.start, period.end] });
}
