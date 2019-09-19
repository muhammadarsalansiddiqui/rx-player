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

import config from "../../config";
import { getNextRange } from "../../utils/ranges";

const { IGNORABLE_DISCONTINUITY } = config;

/**
 * Calculate a buffer gap which ignores discontinuities smaller or equal to
 * `IGNORABLE_DISCONTINUITY` seconds from the current contiguous buffered
 * ranges.
 *
 * This is useful to have a more lax definition of what is the current buffer
 * gap, e.g. to avoid going into BUFFERING mode indefinitely due to poorly
 * formed media with very small - skippable - discontinuities everywhere.
 *
 * Other mechanisms such as discontinuity-detection and discontinuity auto-skip
 * should allow the media to continue playing without issue.
 *
 * @param {number} currentTime - The current position, in seconds.
 * @paraM {number} bufferGap - Current calculated _real_ buffer gap. That is the
 * gap to the next contiguous range, in seconds.
 * @param {TimeRanges} buffered - The inventory of the current available
 * contiguous time ranges.
 */
export default function calculateResilientBufferGap(
  currentTime : number,
  bufferGap : number,
  buffered : TimeRanges
) : number {
  let newTotal : number = 0;
  let lastConsideredPos : number = currentTime;
  if (isFinite(bufferGap)) {
    newTotal = bufferGap;
    lastConsideredPos += bufferGap;
  }
  const nextRange = getNextRange(buffered, lastConsideredPos);
  if (nextRange == null) {
    return bufferGap;
  }

  if (nextRange.start - lastConsideredPos > IGNORABLE_DISCONTINUITY) {
    return bufferGap;
  }

  newTotal += nextRange.end - nextRange.start;
  return calculateResilientBufferGap(nextRange.end, newTotal, buffered);
}
