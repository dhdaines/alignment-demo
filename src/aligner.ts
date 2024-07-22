// -*- js-indent-level: 2 -*-
// Copyright (c) 2022 David Huggins-Daines <dhd@ecolingui.ca>

import { AudioBuffer } from "standardized-audio-context";
import soundswallower_factory, {
  Decoder,
  Segment,
  SoundSwallowerModule,
} from "soundswallower/jsonly";
export { Segment };
// Location of G2P API
const G2P_API = "http://localhost:5000/api/v2";

var soundswallower: SoundSwallowerModule;

export interface BeamSettings {
  beam: number;
  pbeam: number;
  wbeam: number;
}

export enum BeamDefaults {
  strict = "strict",
  moderate = "moderate",
  loose = "loose",
}

const beamParams: { [key in BeamDefaults]: BeamSettings } = {
  strict: {
    beam: 1e-100,
    pbeam: 1e-100,
    wbeam: 1e-80,
  },
  moderate: {
    beam: 1e-200,
    pbeam: 1e-200,
    wbeam: 1e-160,
  },
  loose: {
    beam: 0,
    pbeam: 0,
    wbeam: 0,
  },
};

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

  async reinitialize(mode: BeamDefaults = BeamDefaults.strict) {
    this.recognizer = new soundswallower.Decoder({
      //loglevel: "INFO",
        beam: beamParams[mode]["beam"],
        wbeam: beamParams[mode]["wbeam"],
        pbeam: beamParams[mode]["pbeam"],
    });
    this.recognizer.unset_config("dict");
    await this.recognizer.initialize();
  }

  async get_langs() {
    const response = await fetch(`${G2P_API}/langs`);
    if (response.ok) this.langs = await response.json();
    else
      throw `Failed to fetch ${G2P_API}/langs: ${response.statusText}`;
  }

  async convert(text: string): Promise<Array<any>> {
    let response = await fetch(`${G2P_API}/path/${this.lang}/eng-arpabet`);
    let path = [];
    if (response.ok) path = await response.json()
    else
      throw `Failed to fetch ${G2P_API}/path/${this.lang}/eng-arpabet: ${response.statusText}`;
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
      console.log("Error detail:", detail);
      throw `Failed to fetch ${G2P_API}/convert: ${detail.detail[0].msg}`;
    }
  }

  setup_alignment(g2p: Array<any>) {
    const words: Array<string> = [];
    const dict = new Map<string, string>();
    for (const token of g2p) {
      console.log("token:", JSON.stringify(token));
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

  process_alignment(alignment: Segment, g2p: Array<any>): Segment {
    if (!alignment.w)
      return alignment;
    let idx = 0;
    const words = alignment.w;
    // We already checked that words.length > 0 but check it again
    if (words.length == 0)
      throw "Alignment failed: no words recognized";
    for (const token of g2p) {
      if (token.conversions.length === 0 || token.conversions[0].out_lang === null)
        continue;
      // Double-check that the words line up
      const initial: Array<any> = token.conversions[token.conversions.length - 1].substring_alignments;
      const word = initial.map(alignment => alignment[0]).join("");
      while (!words[idx].w || words[idx].t == "<sil>") { // FIXME: need other noise
        idx++;
        if (idx >= words.length)
          throw `Not all words were properly aligned`;
      }
      const wordseg = words[idx];
      if (wordseg.t !== word)
        throw `Mismatch in segment ${idx}: ${wordseg.t} != ${word}`;
      idx++;
      if (idx >= words.length)
        throw `Not all words were properly aligned`;

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
      console.log("wordseg:", JSON.stringify(wordseg))
    }
    return alignment
  }

  async align(audio: AudioBuffer, text: string): Promise<Segment> {
    if (this.recognizer.get_config("samprate") != audio.sampleRate)
      this.recognizer.set_config("samprate", audio.sampleRate);
    for (const beamWidth of Object.values(BeamDefaults)) {
      console.log("Trying beam settings:", beamWidth);
      await this.reinitialize(beamWidth);
      const g2p = await this.convert(text);
      console.log("g2p:", JSON.stringify(g2p));
      this.setup_alignment(g2p);
      this.recognizer.start();
      this.recognizer.process_audio(audio.getChannelData(0), false, true);
      this.recognizer.stop();
      const alignment = this.recognizer.get_alignment({ align_level: 1 });
      if (alignment.w === undefined || alignment.w.length === 0)
        continue;
      return this.process_alignment(alignment, g2p);
    }
    throw "No alignment found";
  }
}
