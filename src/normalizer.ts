/*
 * Copyright (c) 2024 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

import type * as LibAVT from "@libav.js/variant-webcodecs";
import type * as LibAVWebCodecsBridge from "libavjs-webcodecs-bridge";
import type * as wcp from "libavjs-webcodecs-polyfill";

import * as ifs from "./interfaces";

/**
 * Class for normalizing frames in various formats into LibAV.
 */
export class FrameNormalizer implements ifs.Filter {
    constructor(
        ptr: boolean,

        /**
         * @private
         * LibAV instance.
         */
        private _libav: LibAVT.LibAV,

        /**
         * @private
         * WebCodecs bridge.
         */
        private _lawc: typeof LibAVWebCodecsBridge | undefined,

        /**
         * @private
         * Input frames.
         */
        private _inputP: Promise<ifs.Decoder | ifs.DecoderPtr>
    ) {
        this.ptr = <false> ptr;
        this.stream = new ReadableStream({});
        this.streams = Promise.resolve([]);
    }

    /**
     * @private
     * Normalizers must be initialized.
     */
    private async _init() {
        const la = this._libav;
        const lawc = this._lawc!;
        const input = await this._inputP;
        const packetStream = input.stream.getReader();
        this.streams = input.streams;

        this.stream = new ReadableStream({
            async pull(controller) {
                const rd = await packetStream.read();
                if (rd.done) {
                    controller.close();
                    return;
                }

                const outFrames: ifs.LibAVStreamFrame[] = [];

                async function pushFrame(
                    streamIndex: number, frame: LibAVT.Frame | number
                ) {
                    if (typeof frame === "number") {
                        // Already a libav pointer
                        if (!this.ptr) {
                            outFrames.push({
                                streamIndex,
                                frame: await la.ff_copyout_frame(frame)
                            });
                            await la.av_frame_free_js(frame);
                        } else {
                            outFrames.push({
                                streamIndex,
                                frame: <any> frame
                            });
                        }

                    } else {
                        // Already a libav frame
                        if (this.ptr) {
                            const frm = await la.av_frame_alloc();
                            await la.ff_copyin_frame(frm, frame);
                            outFrames.push({
                                streamIndex,
                                frame: <any> frm
                            });
                        } else {
                            outFrames.push({
                                streamIndex,
                                frame
                            });
                        }

                    }
                }

                for (const streamFrame of rd.value) {
                    const frame = streamFrame.frame;
                    if ((<wcp.VideoFrame> frame).codedWidth) {
                        const laFrame = await lawc.videoFrameToLAFrame(
                            <wcp.VideoFrame> frame
                        );
                        await pushFrame(streamFrame.streamIndex, laFrame);

                    } else if ((<wcp.AudioData> frame).sampleRate) {
                        const laFrame = await lawc.audioDataToLAFrame(
                            <wcp.AudioData> frame
                        );
                        await pushFrame(streamFrame.streamIndex, laFrame);

                    } else {
                        await pushFrame(streamFrame.streamIndex, <any> frame);

                    }
                }

                controller.enqueue(outFrames);
            }
        });
    }

    static async build(
        libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
        init: ifs.InitFrameNormalizer,
        input: Promise<ifs.Decoder | ifs.DecoderPtr>
    ): Promise<ifs.Filter>;
    static async build(
        libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
        init: ifs.InitFrameNormalizerPtr,
        input: Promise<ifs.Decoder | ifs.DecoderPtr>
    ): Promise<ifs.FilterPtr>;

    /**
     * Build a normalizer.
     */
    static async build(
        libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
        init: ifs.InitFrameNormalizer | ifs.InitFrameNormalizerPtr,
        input: Promise<ifs.Decoder | ifs.DecoderPtr>
    ) {
        const ret = new FrameNormalizer(
            init.ptr, libav, lawc, input,
        );
        await ret._init();
        return <any> ret;
    }

    component: "filter" = "filter";
    ptr: false;

    /**
     * Stream of frames.
     */
    stream: ReadableStream<ifs.LibAVStreamFrame[]>;

    /**
     * Stream data.
     */
    streams: Promise<LibAVT.CodecParameters[]>;
}