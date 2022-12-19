// Copyright (c) 2022 David Huggins-Daines <dhdaines@gmail.com>

import { AudioBuffer } from "standardized-audio-context";
import soundswallower_factory, {
  Decoder,
  SoundSwallowerModule,
  FeatureBuffer,
  Config,
} from "soundswallower";

var soundswallower: SoundSwallowerModule;
export var recognizer: Decoder;
export var phoneset: { [arpa: string]: string };

export async function initialize(config: Config) {
  soundswallower = await soundswallower_factory();
  reinitialize(config);
}

export async function reinitialize(config: Config) {
  recognizer = new soundswallower.Decoder(config);
  await recognizer.initialize();
  const hmm = recognizer.get_config("hmm") as string;
  phoneset = await soundswallower.load_json(hmm + "/phoneset.json");
  console.log("Configuration: " + recognizer.get_config_json());
}

export async function align(audio: AudioBuffer, text: string) {
  if (recognizer.get_config("samprate") != audio.sampleRate) {
    recognizer.set_config("samprate", audio.sampleRate);
    await recognizer.reinitialize_audio();
  }
  text = text.toLowerCase();
  recognizer.set_align_text(text);
  recognizer.start();
  console.log(audio);
  const nfr = recognizer.process_audio(audio.getChannelData(0), false, true);
  recognizer.stop();
  return recognizer.get_alignment({ align_level: 1 });
}
