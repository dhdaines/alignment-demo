// Copyright (c) 2022 David Huggins-Daines <dhd@ecolingui.ca>

import { AudioBuffer } from "standardized-audio-context";
import soundswallower_factory, {
  Decoder,
  Segment,
  DictEntry,
  SoundSwallowerModule,
  FeatureBuffer,
  Config,
} from "soundswallower/jsonly";

// Location of G2P API
const G2P_API = "http://localhost:5000/api/v2";

var soundswallower: SoundSwallowerModule;

type Extent = [number, number];
export interface SupportedLanguage {
  code: string;
  name: string | null;
};

export class Aligner {
  public recognizer: Decoder;
  public langs: Array<SupportedLanguage> = [];
  public lang: string = "und";

  async initialize() {
    soundswallower = await soundswallower_factory();
    return Promise.all([this.reinitialize(), this.get_langs()]);
  }

  async reinitialize() {
    this.recognizer = new soundswallower.Decoder();
    this.recognizer.unset_config("dict");
    await this.recognizer.initialize();
  }

  async get_langs() {
    const response = await fetch(`${G2P_API}/langs`);
    if (response.ok) this.langs = await response.json();
    else
      throw new Error(
        `Failed to fetch ${G2P_API}/langs: ${response.statusText}`
      );
  }

  async convert(text: string): Promise<Array<any>> {
    let response = await fetch(`${G2P_API}/path/${this.lang}/eng-arpabet`);
    let path = [];
    if (response.ok) path = await response.json()
    else
      throw new Error(
        `Failed to fetch ${G2P_API}/path/${this.lang}/eng-arpabet: ${response.statusText}`
      );
    let ipa_lang = `${this.lang}-ipa`;
    for (const lang of path) {
      if (lang.includes("-ipa")) {
        ipa_lang = lang;
        break;
      }
    }
    const request = {
      in_lang: this.lang,
      out_lang: "eng-arpabet",
      compose_from: ipa_lang,
      text
    };
    response = await fetch(`${G2P_API}/convert`, {
      method: "POST",
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
      },
    });
    if (response.ok) return response.json();
    else {
      const detail = await response.json();
      console.log(detail);
      throw new Error(
        `Failed to fetch ${G2P_API}/convert: ${detail.detail[0].msg}`
      );
    }
  }

  setup_alignment(g2p: Array<any>) {
    const dict: Array<DictEntry> = [];
    for (const token of g2p) {
      if (token.conversions.length === 0 || token.conversions[0].out_lang === null)
        continue;
      const final: Array<any> = token.conversions[0].alignments;
      const initial: Array<any> = token.conversions[token.conversions.length - 1].alignments;
      const phones = final.map(alignment => alignment[1]).join("");
      const word = initial.map(alignment => alignment[0]).join("");
      dict.push([word, phones]);
    }
    this.recognizer.add_words(...dict);
    const source_text = dict.map(entry => entry[0]).join(" ");
    this.recognizer.set_align_text(source_text);
  }

  process_alignment(alignment: Segment, g2p: Array<any>) {
    if (!alignment.w)
      return alignment;
    let idx = 0;
    const words = alignment.w;
    for (const token of g2p) {
      if (token.conversions.length === 0 || token.conversions[0].out_lang === null)
        continue;
      // Double-check that the words line up
      const initial: Array<any> = token.conversions[token.conversions.length - 1].alignments;
      const word = initial.map(alignment => alignment[0]).join("");
      while (!words[idx].w || words[idx].t == "<sil>") idx++; // FIXME: need other noise
      const seg = words[idx];
      if (seg.t !== word)
        throw new Error(`Mismatch in segment ${idx}: ${seg.t} != ${word}`);
      idx++;

      // Map the phones (most of the work done by compose_from)
      const final: Array<any> = token.conversions[0].alignments;
      for (let jdx = 0; jdx < seg.w!.length; jdx++) {
        seg.w![jdx].t = final[jdx][0];
      }
      console.log(JSON.stringify(seg))
    }
    return alignment;
  }

  async align(audio: AudioBuffer, text: string) {
    if (this.recognizer.get_config("samprate") != audio.sampleRate)
      this.recognizer.set_config("samprate", audio.sampleRate);
    await this.recognizer.initialize();
    const g2p = await this.convert(text);
    console.log(JSON.stringify(g2p));
    this.setup_alignment(g2p);
    this.recognizer.start();
    const nfr = this.recognizer.process_audio(audio.getChannelData(0), false, true);
    this.recognizer.stop();
    const alignment = this.recognizer.get_alignment({ align_level: 1 });
    return this.process_alignment(alignment, g2p);
  }
}
