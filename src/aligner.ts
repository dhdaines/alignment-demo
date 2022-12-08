// Copyright (c) 2022 David Huggins-Daines <dhdaines@gmail.com>

import { AudioBuffer } from "standardized-audio-context";
import soundswallower_factory, {
    Decoder,
    SoundSwallowerModule,
    FeatureBuffer
} from "soundswallower";

var soundswallower: SoundSwallowerModule;
export var recognizer: Decoder;

export async function initialize(config: any) {
    soundswallower = await soundswallower_factory();
    recognizer = new soundswallower.Decoder(config);
    return recognizer.initialize();
}

export async function align(audio: AudioBuffer, text: string) {
    if (recognizer.get_config("samprate") != audio.sampleRate) {
	recognizer.set_config("samprate", audio.sampleRate);
	await recognizer.reinitialize_audio();
    }
    await recognizer.set_align_text(text);
    await recognizer.start();
    console.log(audio);
    const nfr = await recognizer.process(audio.getChannelData(0), false, true);
    await recognizer.stop();
    const jresult = await recognizer.get_alignment_json(0, 1);
    return JSON.parse(jresult);
}
