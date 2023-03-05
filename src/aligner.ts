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
      compose: true,
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
    let tokpos: Array<[number, number]> = [];
    for (const tok of tokens) {
      let end = start + tok.length;
      tokpos.push([start, end]);
      start = end + 1; // space
    }
    // Compose them with alignments get output extents
    const edge = g2p.converted[0];
    const tokpos_next: Array<[number, number]> = [];
    for (const [start, end] of tokpos) {
      const tok: [number, number] = [-1, -1];
      for (const [in_pos, out_pos] of edge.alignments) {
        if (start == in_pos && tok[0] == -1)
          tok[0] = out_pos;
        if (end - 1 == in_pos)
          tok[1] = out_pos + 1;
      }
      tokpos_next.push(tok);
    }
    tokpos = tokpos_next;
    // Tadam, here are our phones
    // except there might be other stuff in there too...
    const dict: Array<DictEntry> = [];
    for (const i in tokens) {
      const [start, end] = tokpos[i];
      const phonestr = edge.text.substring(start, end);
      const entry: DictEntry = [tokens[i], phonestr];
      dict.push(entry);
    }
    this.recognizer.add_words(...dict);
    this.recognizer.set_align_text(g2p.source_text);
  }

  process_alignment(alignment: Segment, g2p: any) {
    // Compose ARPABET with links in reverse until we get to some
    // acceptable IPA
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
