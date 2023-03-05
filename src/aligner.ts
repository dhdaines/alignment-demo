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

export class Aligner {
  public recognizer: Decoder;
  public langs: Array<string> = [];
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
    const response = await fetch(`${G2P_API}/inputs_for/eng-arpabet`);
    if (response.ok) this.langs = await response.json();
    else
      throw new Error(
        `Failed to fetch ${G2P_API}/inputs_for/eng-arpabet: ${response.statusText}`
      );
  }

  async convert(text: string) {
    const request = {
      in_lang: this.lang,
      out_lang: "eng-arpabet",
      text
    };

    const response = await fetch(`${G2P_API}/convert`, {
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

  setup_alignment(tokens: Array<string>, g2p: any) {
    // Construct array of input token extents
    let start = 0;
    let input_tokens: Array<Extent> = [];
    for (const tok of tokens) {
      let end = start + tok.length;
      input_tokens.push([start, end]);
      start = end + 1; // space
    }
    // Compose them with alignments to get output extents
    const converted = g2p.converted.slice().reverse();
    let output_tokens: Array<Extent> = [];
    for (const edge of converted) {
      output_tokens = [];
      for (const [start, end] of input_tokens) {
        const tok: Extent = [-1, -1];
        for (const [in_pos, out_pos] of edge.alignments) {
          if (start == in_pos && tok[0] == -1)
            tok[0] = out_pos;
          if (end - 1 == in_pos)
            tok[1] = out_pos + 1;
        }
        output_tokens.push(tok);
      }
      input_tokens = output_tokens;
    }
    // Tadam, here are our phones
    // except there might be other stuff in there too...
    const dict: Array<DictEntry> = [];
    // NOTE: substring considered harmful, but we will change the API actually...
    const chars = Array.from(g2p.converted[0].text);
    for (const i in tokens) {
      const [start, end] = output_tokens[i];
      const phonestr = chars.slice(start, end).join("");
      const entry: DictEntry = [tokens[i], phonestr];
      dict.push(entry);
    }
    this.recognizer.add_words(...dict);
    this.recognizer.set_align_text(g2p.source_text);
  }

  process_alignment(alignment: Segment, g2p: any) {
    const output_text = g2p.converted[0].text;
    // Construct array of output phone extents
    let pos = 0;
    let output_tokens: Array<Extent> = [];
    if (!alignment.w)
      return alignment;
    for (const { t, b, d, w } of alignment.w) {
      // FIXME: Need to add is_noise() or something to SoundSwallower
      if (!w || t == "<sil>") continue;
      for (const { t } of w) {
        // FIXME: This may be mismatched with the alignments because they are in code points, not code units
        const start = output_text.indexOf(t, pos);
        if (start == -1)
          throw new Error(`Could not find ${t} at ${pos} (${output_text.substr(pos)})`);
        // FIXME: This may be mismatched with the alignments because they are in code points, not code units
        const end = start + t.length;
        pos = end;
        output_tokens.push([start, end]);
      }
    }
    console.log(JSON.stringify(output_tokens.map(([start, end]) => output_text.substring(start, end))));
    // Walk them back to the first ipa conversion
    let input_tokens: Array<Extent> = [];
    // NOTE that we do this in the provided order this time
    let last_ipa_idx = 0;
    for (let idx = 0; idx < g2p.converted.length; idx++)
      if (g2p.converted[idx].out_lang.includes("-ipa"))
        last_ipa_idx = idx;
    console.log(last_ipa_idx);
    const input_text = g2p.converted[last_ipa_idx].text;
    for (let idx = 0; idx < g2p.converted.length; idx++) {
      if (idx == last_ipa_idx) break;
      const edge = g2p.converted[idx];
      input_tokens = [];
      for (const [start, end] of output_tokens) {
        const tok: Extent = [-1, -1];
        for (const [in_pos, out_pos] of edge.alignments) {
          if (start == out_pos && tok[0] == -1)
            tok[0] = in_pos;
          if (end - 1 == out_pos)
            tok[1] = in_pos + 1;
        }
        input_tokens.push(tok);
      }
      output_tokens = input_tokens;
    }
    console.log(JSON.stringify(input_tokens.map(x => input_text.substring(...x))));
    // Now splice them into the original alignment!
    let idx = 0;
    for (const { t, b, d, w } of alignment.w) {
      // FIXME: Need to add is_noise() or something to SoundSwallower
      if (!w || t == "<sil>") continue;
      for (let jdx = 0; jdx < w.length; jdx++) {
        w[jdx].t = input_text.substring(...input_tokens[idx++]);
      }
    }
    console.log(JSON.stringify(alignment));
    return alignment;
  }

  async align(audio: AudioBuffer, text: string) {
    if (this.recognizer.get_config("samprate") != audio.sampleRate)
      this.recognizer.set_config("samprate", audio.sampleRate);
    await this.recognizer.initialize();
    const tokens = text.trim().split(/\s+/);
    const g2p = await this.convert(tokens.join(" "));
    this.setup_alignment(tokens, g2p);
    this.recognizer.start();
    const nfr = this.recognizer.process_audio(audio.getChannelData(0), false, true);
    this.recognizer.stop();
    const alignment = this.recognizer.get_alignment({ align_level: 1 });
    return this.process_alignment(alignment, g2p);
  }
}
