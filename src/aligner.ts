// Copyright (c) 2022 David Huggins-Daines <dhd@ecolingui.ca>

import { AudioBuffer } from "standardized-audio-context";
import soundswallower_factory, {
  Decoder,
  SoundSwallowerModule,
  FeatureBuffer,
  Config,
} from "soundswallower/jsonly";

var soundswallower: SoundSwallowerModule;

export class Aligner {
  public recognizer: Decoder;
  public phoneset: { [arpa: string]: string };

  async initialize(config: Config) {
    soundswallower = await soundswallower_factory();
    this.reinitialize(config);
  }

  async reinitialize(config: Config) {
    this.recognizer = new soundswallower.Decoder(config);
    await this.recognizer.initialize();
    const hmm = this.recognizer.get_config("hmm") as string;
    this.phoneset = await soundswallower.load_json(hmm + "/phoneset.json");
    console.log("Configuration: " + this.recognizer.get_config_json());
  }

  async align(audio: AudioBuffer, text: string) {
    if (this.recognizer.get_config("samprate") != audio.sampleRate) {
      this.recognizer.set_config("samprate", audio.sampleRate);
      await this.recognizer.reinitialize_audio();
    }
    text = text.toLowerCase();
    this.recognizer.set_align_text(text);
    this.recognizer.start();
    console.log(audio);
    const nfr = this.recognizer.process_audio(audio.getChannelData(0), false, true);
    this.recognizer.stop();
    return this.recognizer.get_alignment({ align_level: 1 });
  }
}
