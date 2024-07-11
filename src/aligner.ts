// Copyright (c) 2022 David Huggins-Daines <dhd@ecolingui.ca>

import { AudioBuffer } from "standardized-audio-context";
import soundswallower_factory, {
  Decoder,
  Segment,
  SoundSwallowerModule,
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
    const words: Array<string> = [];
    const dict = new Map<string, string>();
    for (const token of g2p) {
      console.log(JSON.stringify(token));
      if (token.conversions.length === 0 || token.conversions[0].out_lang === null)
        continue;
      const final: Array<any> = token.conversions[0].substring_alignments;
      const initial: Array<any> = token.conversions[token.conversions.length - 1].substring_alignments;
      const phones = final.map(alignment => alignment[1]).join("");
      const word = initial.map(alignment => alignment[0]).join("");
      words.push(word)
      dict.set(word, phones);
    }
    this.recognizer.add_words(...Array.from(dict.entries()));
    this.recognizer.set_align_text(words.join(" "));
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
      const initial: Array<any> = token.conversions[token.conversions.length - 1].substring_alignments;
      const word = initial.map(alignment => alignment[0]).join("");
      while (!words[idx].w || words[idx].t == "<sil>") idx++; // FIXME: need other noise
      const wordseg = words[idx];
      if (wordseg.t !== word)
        throw new Error(`Mismatch in segment ${idx}: ${wordseg.t} != ${word}`);
      idx++;

      // Map the phones.  Note that the output alignments, being
      // character-based, do not necessarily correspond to ARPABET
      // phones.  Sadly this is a limitation of G2P, no way around it.
      const input: Array<any> = token.conversions[0].substring_alignments;
      const output: Array<Segment> = wordseg.w!;
      let input_idx = 0;
      let output_idx = 0;
      let input_phone = "";
      let output_phone = "";
      while (output_idx < output.length && input_idx < input.length) {
        const orig_output = output[output_idx].t;
        // FIXME: This is not entirely correct...
        while (output_phone.length < orig_output.length) {
          const [ipa, arpa] = input[input_idx];
          input_phone += ipa;
          output_phone += arpa;
          input_idx++;
        }
        // NOTE: depends on having space as delimiters...
        const output_phones = output_phone.split(" ").filter(p => p.length);
        // console.log(input_phone, output_phones)
        output[output_idx].t = input_phone;
        for (let idx = 1; idx < output_phones.length; idx++) {
          output[output_idx].d += output[output_idx + idx].d;
          delete output[output_idx + idx]
        }
        output_idx += output_phones.length;
        input_phone = "";
        output_phone = "";
      }
      wordseg.w = output.filter(s => typeof(s) !== "undefined");
      // console.log(JSON.stringify(wordseg))
    }
    return alignment
  }

  async align(audio: AudioBuffer, text: string) {
    if (this.recognizer.get_config("samprate") != audio.sampleRate)
      this.recognizer.set_config("samprate", audio.sampleRate);
    await this.recognizer.initialize();
    const g2p = await this.convert(text);
    // console.log(JSON.stringify(g2p));
    this.setup_alignment(g2p);
    this.recognizer.start();
    const nfr = this.recognizer.process_audio(audio.getChannelData(0), false, true);
    this.recognizer.stop();
    const alignment = this.recognizer.get_alignment({ align_level: 1 });
    return this.process_alignment(alignment, g2p);
  }
}
